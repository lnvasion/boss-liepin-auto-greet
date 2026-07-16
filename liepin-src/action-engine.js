/**
 * action-engine.js — 自动化执行引擎 (猎聘版)
 *
 * 策略: API直调用为主 → React handler调用为降级
 * 与BOSS不同: 无iframe、无弹窗处理、单页架构
 */
import { EVENTS, RUN_STATES, MAX_CONSECUTIVE_FAILURES } from './constants.js';
import { cardScanner } from './card-scanner.js';
import { stateManager } from './state-manager.js';
import { logger } from './logger.js';
import { candidateDB } from './database.js';
import { sendGreetAPI, extractProfile } from './api-greet.js';

class ActionEngine {
  constructor() {
    this._eventBus = null;
    this._running = false;
    this._retryCount = 0;
  }

  setEventBus(bus) { this._eventBus = bus; }

  async start() {
    if (this._running) return;
    this._running = true;
    stateManager.startSession();
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
    logger.info(stateManager.isDryRun()
      ? '🟡 Dry-run 模式启动'
      : '🟢 自动化已启动');

    try { await this._mainLoop(); } catch (e) {
      logger.error('主循环异常', e.message);
    } finally { this._running = false; }
  }

  pause() {
    this._running = false;
    stateManager.setRunState(RUN_STATES.PAUSED);
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.PAUSED);
    logger.warn('自动化已暂停');
  }

  async resume() {
    if (this._running) return;
    this._running = true;
    stateManager.setRunState(RUN_STATES.RUNNING);
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
    logger.info('自动化已恢复');
    try { await this._mainLoop(); } catch (e) {
      logger.error('主循环异常', e.message);
    } finally { this._running = false; }
  }

  stop() {
    this._running = false;
    stateManager.setRunState(RUN_STATES.STOPPED);
    this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.STOPPED);
    logger.info('自动化已停止');
  }

  async _mainLoop() {
    let cardQueue = [];

    while (this._running && stateManager.getRunState() === RUN_STATES.RUNNING) {
      if (stateManager.hasReachedLimit()) {
        logger.success('达到上限，停止');
        this._eventBus?.emit(EVENTS.LIMIT_REACHED);
        this.stop();
        break;
      }

      if (stateManager.getFailureCount() >= MAX_CONSECUTIVE_FAILURES) {
        logger.error('连续失败过多，停止');
        this.stop();
        break;
      }

      // Queue empty → refill
      if (cardQueue.length === 0) {
        const cards = cardScanner.scanCards();
        if (cards.length === 0) {
          logger.warn('未找到候选人，3秒后重试');
          await this._sleep(3000);
          continue;
        }
        cardQueue = cards.filter((c) => !stateManager.isProcessed(c.id));
        if (cardQueue.length === 0) {
          logger.info('本页候选人已全部处理，滚动加载更多');
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          await this._sleep(2000);
          const newCards = cardScanner.scanCards();
          cardQueue = newCards.filter((c) => !stateManager.isProcessed(c.id));
          if (cardQueue.length === 0) {
            logger.info('没有更多候选人');
            break;
          }
        }
        logger.info('待处理: ' + cardQueue.length + ' 位候选人');
      }

      const card = cardQueue.shift();
      logger.info('沟通: ' + card.name);
      const result = await this._greetCandidate(card);

      if (result.success) {
        stateManager.markProcessed(card.id);
        stateManager.incrementGreeted();
        stateManager.resetFailure();
        this._retryCount = 0;

        const profile = result.profile || extractProfile(card);
        candidateDB.insert({
          id: card.id,
          name: card.name,
          description: card.title || card.expectPosition,
          dryRun: stateManager.isDryRun(),
          greetingSent: result.greeting || '',
          ...profile,
        });

        this._eventBus?.emit(EVENTS.CARD_PROCESSED);
        this._eventBus?.emit(EVENTS.DB_UPDATED);
        logger.success('ok: ' + card.name + ' (' + stateManager.getTotalGreeted() + '/' + stateManager.getMaxPerSession() + ')');
      } else {
        stateManager.incrementFailure();
        this._retryCount++;
        logger.error('fail: ' + card.name + ' - ' + (result.error || ''));
      }

      // 间隔延迟
      await this._sleep(stateManager.getMinDelay() + Math.random() * (stateManager.getMaxDelay() - stateManager.getMinDelay()));
    }

    logger.info('主循环结束');
  }

  async _greetCandidate(card) {
    if (stateManager.isDryRun()) {
      logger.info('[DRY-RUN] 模拟沟通: ' + card.name);
      await this._sleep(1000 + Math.random() * 1000);
      return { success: true, message: 'Dry-run模拟成功', method: 'dry-run' };
    }

    // Tier 0: API 直接调用 (优先)
    logger.debug('Tier 0: API直接打招呼...');
    const apiResult = await sendGreetAPI(card);
    if (apiResult.success) {
      return { success: true, message: 'API成功', method: 'api', greeting: apiResult.greeting, profile: extractProfile(card) };
    }

    // Tier 1: React handler 降级
    if (card.greetHandler) {
      logger.debug('API失败，尝试React handler...');
      try {
        const fakeEvent = {
          stopPropagation: () => {}, preventDefault: () => {},
          nativeEvent: { stopImmediatePropagation: () => {} },
          target: card.element, currentTarget: card.element,
          type: 'click', button: 0,
        };
        card.greetHandler(fakeEvent);
        await this._sleep(2000);
        return { success: true, message: 'React handler成功', method: 'react-handler' };
      } catch (e) {
        logger.debug('React handler失败: ' + e.message);
      }
    }

    return { success: false, error: apiResult.error || '所有策略均失败' };
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

export const actionEngine = new ActionEngine();
