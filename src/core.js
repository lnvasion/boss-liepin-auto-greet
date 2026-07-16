/**
 * core.js — 核心编排器
 *
 * 模块初始化、生命周期管理、事件总线、错误恢复
 */
import { EVENTS, RUN_STATES } from './constants.js';
import { logger } from './logger.js';
import { stateManager } from './state-manager.js';
import { cardScanner } from './card-scanner.js';
import { actionEngine } from './action-engine.js';
import { uiPanel } from './ui-panel.js';
import { startNetCapture } from './net-capture.js';
import {
  setupCaptchaObserver,
  setupVisibilityHandler,
} from './anti-detect.js';

/**
 * 简易事件总线
 */
class EventBus {
  constructor() {
    this._listeners = {};
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
  }

  emit(event, data) {
    if (!this._listeners[event]) return;
    for (const cb of this._listeners[event]) {
      try {
        cb(data);
      } catch (e) {
        logger.error(`事件处理器错误 [${event}]`, e.message);
      }
    }
  }
}

/**
 * 应用核心
 */
class AppCore {
  constructor() {
    this.eventBus = new EventBus();
    this._captchaObserver = null;
    this._visibilityHandler = null;
    this._initialized = false;
  }

  /**
   * 初始化应用
   */
  async init() {
    if (this._initialized) return;

    logger.info('BOSS 自动沟通工具 v0.1.0 初始化...');

    // 0. 启动网络捕获 (捕获打招呼请求)
    startNetCapture();

    // 1. 检查iframe: 如果在父页面，等待iframe加载
    if (!cardScanner.isInIframe()) {
      logger.info('检测到父页面，等待推荐iframe加载...');
      const iframeDoc = await cardScanner.waitForIframe(15000);
      if (!iframeDoc) {
        logger.error('无法加载推荐iframe，请确认页面已完全加载');
        return;
      }
    } else {
      logger.info('检测到iframe页面，直接初始化...');
    }

    // 1. 恢复状态
    stateManager.init();

    // 2. 绑定事件总线
    actionEngine.setEventBus(this.eventBus);
    uiPanel.mount(this.eventBus);

    // 3. 注册事件处理
    this._registerEvents();

    // 4. 启动反检测监控 (监控iframe文档)
    const targetDoc = cardScanner.getTargetDocument() || document;
    this._captchaObserver = setupCaptchaObserver(
      () => {
        this.eventBus.emit(EVENTS.CAPTCHA_DETECTED);
        stateManager.incrementCaptcha();
        if (stateManager.getRunState() === RUN_STATES.RUNNING) {
          actionEngine.pause();
        }
      },
      () => {
        this.eventBus.emit(EVENTS.CAPTCHA_RESOLVED);
      },
      targetDoc  // 监控iframe内的验证码
    );

    this._visibilityHandler = setupVisibilityHandler(
      () => {
        // 标签页隐藏时自动暂停
        if (stateManager.getRunState() === RUN_STATES.RUNNING) {
          actionEngine.pause();
        }
      },
      () => {
        // 标签页可见时不自动恢复，让用户手动操作
        logger.info('标签页恢复可见，请手动点击"继续"以恢复自动化');
      }
    );

    // 5. 初始卡片扫描
    try {
      const cards = cardScanner.scanCards();
      logger.info(`初始化完成，检测到 ${cards.length} 位候选人`, {
        dryRun: stateManager.isDryRun(),
        delay: `${stateManager.getMinDelay() / 1000}-${stateManager.getMaxDelay() / 1000}s`,
      });
    } catch (e) {
      logger.warn('初始卡片扫描不完整', e.message);
    }

    this._initialized = true;

    // 6. 尝试连接监控 WebSocket (可选)
    logger.connectWS();

    logger.success('✅ 工具就绪！');
    logger.info('请检查控制面板，点击"开始"启动自动化');
    if (stateManager.isDryRun()) {
      logger.info('🟡 当前为 Dry-run (演练) 模式，不会真实发送消息');
    }
  }

  /**
   * 注册事件处理
   */
  _registerEvents() {
    const bus = this.eventBus;

    bus.on(EVENTS.START, async () => {
      if (stateManager.getRunState() === RUN_STATES.RUNNING) {
        logger.warn('已在运行中');
        return;
      }
      await actionEngine.start();
    });

    bus.on(EVENTS.PAUSE, () => {
      if (stateManager.getRunState() === RUN_STATES.RUNNING) {
        actionEngine.pause();
      } else {
        logger.warn('当前不在运行状态');
      }
    });

    bus.on(EVENTS.RESUME, async () => {
      if (stateManager.getRunState() === RUN_STATES.PAUSED) {
        await actionEngine.resume();
      } else {
        logger.warn('当前不在暂停状态');
      }
    });

    bus.on(EVENTS.STOP, () => {
      actionEngine.stop();
    });

    bus.on(EVENTS.CAPTCHA_DETECTED, () => {
      logger.captcha('请手动完成验证码后点击"继续"');
    });

    bus.on(EVENTS.STATE_CHANGED, (state) => {
      uiPanel.updateStatus(state);
    });

    bus.on(EVENTS.LIMIT_REACHED, () => {
      logger.success('会话限制已到达，今日沟通完成');
    });
  }

  /**
   * 销毁应用
   */
  destroy() {
    actionEngine.stop();
    this._captchaObserver?.disconnect();
    this._visibilityHandler?.disconnect();
    uiPanel.destroy();
    this._initialized = false;
    logger.info('工具已卸载');
  }
}

// 单例
export const appCore = new AppCore();
