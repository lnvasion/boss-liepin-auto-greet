/**
 * action-engine.js — 自动化执行引擎
 *
 * 核心自动化逻辑：三层点击策略、弹窗处理、招呼语发送、结果确认
 */
import {
  EVENTS,
  RUN_STATES,
  GREET_DIALOG_SELECTORS,
  GREET_SEND_SELECTORS,
  MAX_CONSECUTIVE_FAILURES,
} from './constants.js';
import {
  humanDelay,
  humanScrollToElement,
  dispatchHumanClick,
  waitForElement,
  waitForElementRemoval,
  randomIdleAction,
  exponentialBackoff,
} from './anti-detect.js';
import { cardScanner } from './card-scanner.js';
import { stateManager } from './state-manager.js';
import { logger } from './logger.js';
import { candidateDB } from './database.js';
import { sendGreetAPI, extractProfile } from './api-greet.js';

/**
 * 招呼语发送结果
 * @typedef {Object} GreetResult
 * @property {boolean} success
 * @property {string} message
 * @property {string} [method] - 使用的点击策略
 * @property {string} [error] - 错误信息
 */

class ActionEngine {
  constructor() {
    this._eventBus = null;
    this._running = false;
    this._retryCount = 0;
  }

  /**
   * 绑定事件总线
   */
  setEventBus(bus) { this._eventBus = bus; }

  /**
   * 开始自动化循环
   */
  async start() {
    if (this._running) return;
    this._running = true;
    stateManager.startSession();
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
    logger.info(stateManager.isDryRun()
      ? '🟡 Dry-run 模式启动（不会真实发送消息）'
      : '🟢 自动化已启动');

    try {
      await this._mainLoop();
    } catch (e) {
      logger.error('自动化主循环异常', e.message);
    } finally {
      this._running = false;
    }
  }

  /**
   * 暂停
   */
  pause() {
    this._running = false;
    stateManager.setRunState(RUN_STATES.PAUSED);
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.PAUSED);
    logger.warn('自动化已暂停');
  }

  /**
   * 恢复
   */
  async resume() {
    if (this._running) return;
    this._running = true;
    stateManager.setRunState(RUN_STATES.RUNNING);
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
    logger.info('自动化已恢复');
    try {
      await this._mainLoop();
    } catch (e) {
      logger.error('自动化主循环异常', e.message);
    } finally {
      this._running = false;
    }
  }

  /**
   * 停止
   */
  stop() {
    this._running = false;
    stateManager.setRunState(RUN_STATES.STOPPED);
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.STOPPED);
    logger.info('自动化已停止');
  }

  /**
   * 主循环：收集本页所有按钮 → 逐个处理 → 页面刷新后重新收集
   */
  async _mainLoop() {
    let cardQueue = [];

    while (this._running && stateManager.getRunState() === RUN_STATES.RUNNING) {

      if (stateManager.hasReachedLimit()) {
        logger.success('reach limit, stopping');
        this._eventBus?.emit(EVENTS.LIMIT_REACHED);
        this.stop();
        break;
      }

      if (stateManager.getFailureCount() >= MAX_CONSECUTIVE_FAILURES) {
        logger.error('too many failures, stopping');
        this.stop();
        break;
      }

      // queue empty -> refill from page
      if (cardQueue.length === 0) {
        const cards = cardScanner.scanCards();
        if (cards.length === 0) {
          logger.warn('no cards found, retry in 3s');
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        cardQueue = cards.filter(c => !stateManager.isProcessed(c.id));

        if (cardQueue.length === 0) {
          logger.info('all cards processed, scroll for more');
          const tgtWin = cardScanner.getTargetWindow();
          const tgtDoc = cardScanner.getTargetDocument() || document;
          tgtWin.scrollTo({ top: tgtDoc.body.scrollHeight, behavior: 'smooth' });
          await new Promise((r) => setTimeout(r, 2000));
          const newCards = await cardScanner.waitForNewCards(3000);
          if (newCards.length === 0) {
            logger.info('no more cards');
            break;
          }
          cardQueue = newCards.filter(c => !stateManager.isProcessed(c.id));
          if (cardQueue.length === 0) continue;
        }

        logger.info('collected ' + cardQueue.length + ' candidates, processing...');
      }

      const card = cardQueue.shift();

      // check if card still in DOM (page refresh may have removed it)
      const targetDoc = cardScanner.getTargetDocument();
      const btnValid = card.greetButton && targetDoc && targetDoc.contains(card.greetButton);
      if (!btnValid) {
        logger.debug('card removed from DOM: ' + card.name + ', skipping');
        continue;
      }

      logger.info('greeting: ' + card.name);
      const result = await this.greetCandidate(card);

      if (result.success) {
        stateManager.markProcessed(card.id);
        stateManager.incrementGreeted();
        stateManager.resetFailure();
        this._retryCount = 0;

        const profile = result.profile || {};
        candidateDB.insert({
          id: card.id,
          name: card.name,
          description: card.title,
          dryRun: stateManager.isDryRun(),
          ageDesc: profile.ageDesc,
          gender: profile.gender,
          workYears: profile.workYears,
          degree: profile.degree,
          education: profile.education,
          lastWork: profile.lastWork,
          expectLocation: profile.expectLocation,
          expectPosition: profile.expectPosition,
          activeTime: profile.activeTime,
        });

        this._eventBus?.emit(EVENTS.CARD_PROCESSED);
        this._eventBus?.emit(EVENTS.DB_UPDATED);
        logger.success('ok: ' + card.name + ' (' + stateManager.getTotalGreeted() + '/' + stateManager.getMaxPerSession() + ')');
      } else {
        stateManager.incrementFailure();
        this._retryCount++;
        logger.error('fail: ' + card.name + ' - ' + (result.error || result.message));
        if (this._retryCount > 0) {
          await exponentialBackoff(this._retryCount - 1);
        }
      }

      await randomIdleAction();

      if (this._running && stateManager.getRunState() === RUN_STATES.RUNNING) {
        const min = stateManager.getMinDelay();
        const max = stateManager.getMaxDelay();
        await humanDelay(min, max, (min + max) / 2, (max - min) / 4);
      }
    }

    logger.info('auto loop ended');
  }

  /**
   * 向候选人发起沟通
   * 策略: Tier 0 API直调用 → Tier 1-3 DOM点击
   * @param {import('./card-scanner.js').CardInfo} card
   * @returns {Promise<GreetResult>}
   */
  async greetCandidate(card) {
    const TIMEOUT = 30000;

    const doGreet = async () => {
      if (stateManager.isDryRun()) {
        logger.info(`[DRY-RUN] 模拟沟通: ${card.name}`, {
          name: card.name, title: card.title, company: card.company,
          hasButton: !!card.greetButton, hasVueInstance: !!card.vueInstance,
        });
        await humanDelay(1000, 2000, 1500, 200);
        return { success: true, message: 'Dry-run 模拟成功', method: 'dry-run' };
      }

      // Tier 0: API直接调用 (优先策略，避免页面刷新)
      const cardIndex = cardScanner.currentCards.indexOf(card);
      if (cardIndex >= 0) {
        logger.debug('Tier 0: 尝试API直接打招呼...');
        const apiResult = await sendGreetAPI(card, cardIndex);
        if (apiResult.success) {
          return { success: true, message: "API打招呼成功", method: "api-direct", profile: extractProfile(apiResult.entry) };
        }
        logger.debug('API打招呼失败，降级到DOM点击: ' + (apiResult.error || 'unknown'));
      }

      // Tier 1-3: DOM点击策略 (降级)
      await humanScrollToElement(card.element, cardScanner.getTargetWindow());
      await humanDelay(800, 1500, 1000, 200);

      const clickResult = await this._threeTierClick(card);
      if (!clickResult.success) return clickResult;

      await humanDelay(800, 2000, 1200, 300);

      const dialogResult = await this._handleGreetDialog();
      if (!dialogResult.success) return dialogResult;

      await humanDelay(1000, 3000, 2000, 500);
      return { success: true, message: '沟通成功', method: clickResult.method };
    };

    // 竞速：操作 vs 超时
    const result = await Promise.race([
      doGreet(),
      new Promise((resolve) =>
        setTimeout(() => resolve({ success: false, message: '操作超时', error: 'timeout' }), TIMEOUT)
      ),
    ]);

    return result;
  }

  /**
   * 三层点击策略
   */
  async _threeTierClick(card) {
    // Tier 1: Vue组件实例操作
    const vueResult = await this._tryVueClick(card);
    if (vueResult.success) {
      return { ...vueResult, method: 'vue-component' };
    }

    logger.debug('Vue组件操作失败，尝试事件派发...');

    // Tier 2: 完整事件链派发
    if (card.greetButton) {
      try {
        await dispatchHumanClick(card.greetButton);
        logger.debug('Tier 2: 事件链派发完成');
        // 给一点时间让事件处理
        await humanDelay(500, 1000, 700, 150);

        // 检查是否出现了弹窗（验证点击是否生效）
        const dialog = this._findDialog();
        if (dialog) {
          return { success: true, message: '事件派发成功', method: 'event-chain' };
        }

        // 检查是否已沟通标记出现
        const newCards = cardScanner.scanCards();
        const updatedCard = newCards.find((c) => c.id === card.id);
        if (updatedCard && updatedCard.alreadyGreeted) {
          return { success: true, message: '已标记为已沟通', method: 'event-chain' };
        }
      } catch (e) {
        logger.debug('Tier 2 失败:', e.message);
      }
    }

    // Tier 3: 直接click
    if (card.greetButton) {
      try {
        card.greetButton.click();
        logger.debug('Tier 3: 直接 click()');
        await humanDelay(500, 1000, 700, 150);

        const dialog = this._findDialog();
        if (dialog) {
          return { success: true, message: '直接点击成功', method: 'direct-click' };
        }
      } catch (e) {
        logger.debug('Tier 3 失败:', e.message);
      }
    }

    return { success: false, message: '所有点击策略均失败', error: 'no-valid-click-method' };
  }

  /**
   * 尝试通过Vue组件实例触发沟通
   */
  async _tryVueClick(card) {
    const vueInst = card.vueInstance;
    if (!vueInst) return { success: false, message: '未找到Vue实例' };

    try {
      // Vue 2: 通过 $el.__vue__ 访问
      if (vueInst.handleGreet) {
        vueInst.handleGreet();
        return { success: true, message: '调用 handleGreet()' };
      }

      // 尝试常见的方法名
      const methodNames = ['greet', 'onGreet', 'handleGreet', 'startChat', 'onStartChat',
        'sendGreeting', 'handleClickGreet', 'openDialog', 'showGreet', 'chat'];

      for (const method of methodNames) {
        if (typeof vueInst[method] === 'function') {
          logger.debug(`Vue实例方法调用: ${method}()`);
          vueInst[method]();
          return { success: true, message: `调用 ${method}()` };
        }
      }

      // Vue 3: 尝试 setupState / ctx
      if (vueInst.setupState) {
        for (const method of methodNames) {
          if (typeof vueInst.setupState[method] === 'function') {
            vueInst.setupState[method]();
            return { success: true, message: `调用 setupState.${method}()` };
          }
        }
      }

      // 尝试 proxy (Vue 3 Composition API)
      if (vueInst.proxy) {
        for (const method of methodNames) {
          if (typeof vueInst.proxy[method] === 'function') {
            vueInst.proxy[method]();
            return { success: true, message: `调用 proxy.${method}()` };
          }
        }
      }

      // 尝试修改响应式状态
      const stateKeys = ['showGreet', 'greetVisible', 'dialogVisible', 'chatVisible', 'showDialog', 'visible'];
      for (const key of stateKeys) {
        if (key in vueInst) {
          vueInst[key] = true;
          return { success: true, message: `设置 ${key}=true` };
        }
        if (vueInst.setupState && key in vueInst.setupState) {
          vueInst.setupState[key] = true;
          return { success: true, message: `设置 setupState.${key}=true` };
        }
        if (vueInst.proxy && key in vueInst.proxy) {
          vueInst.proxy[key] = true;
          return { success: true, message: `设置 proxy.${key}=true` };
        }
      }

      return { success: false, message: 'Vue实例中未找到可用方法或状态', error: 'no-vue-method' };
    } catch (e) {
      return { success: false, message: 'Vue实例操作异常', error: e.message };
    }
  }

  /**
   * 查找招呼语弹窗
   */
  _findDialog() {
    for (const selector of GREET_DIALOG_SELECTORS) {
      try {
        const el = (cardScanner.getTargetDocument()||document).querySelector(selector);
        if (el && el.offsetHeight > 0) return el;
      } catch (e) { /* skip */ }
    }
    return null;
  }

  /**
   * 处理招呼语弹窗
   */
  async _handleGreetDialog() {
    // 等待弹窗出现
    let dialog = null;
    for (const selector of GREET_DIALOG_SELECTORS) {
      dialog = await waitForElement(selector, 3000, cardScanner.getTargetDocument()||document);
      if (dialog) break;
    }

    if (!dialog) {
      // 没有弹窗 — 可能是直接发送的类型
      logger.debug('未检测到招呼语弹窗，可能直接发送成功');
      return { success: true, message: '无弹窗（直接发送）' };
    }

    logger.debug('检测到招呼语弹窗');

    // 检查是否有自定义招呼语模板
    const template = stateManager.getGreetingTemplate();
    if (template) {
      // 尝试找到输入框并填入自定义文本
      const inputSelectors = ['textarea', 'input[type="text"]', '[contenteditable="true"]', '[class*="input"]'];
      for (const sel of inputSelectors) {
        try {
          const input = dialog.querySelector(sel);
          if (input) {
            input.value = template;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            logger.debug('已填入自定义招呼语');
            break;
          }
        } catch (e) { /* skip */ }
      }
    }

    // 等待一会
    await humanDelay(300, 800, 500, 150);

    // 找到发送/确认按钮
    let sendButton = null;
    for (const selector of GREET_SEND_SELECTORS) {
      try {
        sendButton = dialog.querySelector(selector);
        if (sendButton && !sendButton.disabled) break;
      } catch (e) { /* skip */ }
    }

    if (!sendButton) {
      // 在整个文档中查找
      for (const selector of GREET_SEND_SELECTORS) {
        try {
          sendButton = (cardScanner.getTargetDocument()||document).querySelector(selector);
          if (sendButton && !sendButton.disabled) break;
        } catch (e) { /* skip */ }
      }
    }

    if (!sendButton) {
      logger.warn('未找到发送按钮，尝试关闭弹窗');
      // 查找关闭按钮
      const closeBtn = dialog.querySelector('[class*="close"], [class*="cancel"], .icon-close');
      if (closeBtn) closeBtn.click();
      return { success: false, message: '未找到发送按钮', error: 'no-send-button' };
    }

    // 发送
    await dispatchHumanClick(sendButton);
    logger.debug('已点击发送按钮');

    // 等待弹窗关闭
    const removed = await waitForElementRemoval(
      GREET_DIALOG_SELECTORS[0],
      5000, cardScanner.getTargetDocument()||document
    );

    if (!removed) {
      logger.warn('弹窗可能未关闭');
    }

    return { success: true, message: '招呼语已发送' };
  }
}

// 单例
export const actionEngine = new ActionEngine();
