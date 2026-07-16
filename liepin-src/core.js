/**
 * core.js — 核心编排器 (猎聘版)
 */
import { EVENTS, RUN_STATES } from './constants.js';
import { logger } from './logger.js';
import { stateManager } from './state-manager.js';
import { cardScanner } from './card-scanner.js';
import { actionEngine } from './action-engine.js';
import { uiPanel } from './ui-panel.js';

class EventBus {
  constructor() { this._listeners = {}; }
  on(e, cb) {
    if (!this._listeners[e]) this._listeners[e] = [];
    this._listeners[e].push(cb);
  }
  off(e, cb) {
    if (!this._listeners[e]) return;
    this._listeners[e] = this._listeners[e].filter((c) => c !== cb);
  }
  emit(e, data) {
    if (!this._listeners[e]) return;
    for (const cb of this._listeners[e]) {
      try { cb(data); } catch (err) { logger.error('事件错误 [' + e + ']', err.message); }
    }
  }
}

class AppCore {
  constructor() {
    this.eventBus = new EventBus();
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    logger.info('猎聘自动沟通工具 v0.1.0 初始化...');

    stateManager.init();
    actionEngine.setEventBus(this.eventBus);
    uiPanel.mount(this.eventBus);
    this._registerEvents();

    // 初始扫描
    try {
      const cards = cardScanner.scanCards();
      logger.info('初始化完成，检测到 ' + cards.length + ' 位候选人', {
        dryRun: stateManager.isDryRun(),
        delay: `${stateManager.getMinDelay()/1000}-${stateManager.getMaxDelay()/1000}s`,
      });
    } catch (e) {
      logger.warn('初始扫描不完整', e.message);
    }

    this._initialized = true;
    logger.success('✅ 工具就绪！');
    logger.info('请点击"开始"启动自动化');
    if (stateManager.isDryRun()) {
      logger.info('🟡 当前为 Dry-run 模式，不会真实发送消息');
    }
  }

  _registerEvents() {
    const bus = this.eventBus;
    bus.on(EVENTS.START, async () => {
      if (stateManager.getRunState() === RUN_STATES.RUNNING) { logger.warn('已在运行中'); return; }
      await actionEngine.start();
    });
    bus.on(EVENTS.PAUSE, () => {
      if (stateManager.getRunState() === RUN_STATES.RUNNING) actionEngine.pause();
      else logger.warn('当前不在运行状态');
    });
    bus.on(EVENTS.RESUME, async () => {
      if (stateManager.getRunState() === RUN_STATES.PAUSED) await actionEngine.resume();
      else logger.warn('当前不在暂停状态');
    });
    bus.on(EVENTS.STOP, () => actionEngine.stop());
    bus.on(EVENTS.LIMIT_REACHED, () => logger.success('会话限制已到达'));
    bus.on(EVENTS.STATE_CHANGED, (s) => uiPanel.updateStatus(s));
  }

  destroy() {
    actionEngine.stop();
    uiPanel.destroy();
    this._initialized = false;
    logger.info('工具已卸载');
  }
}

export const appCore = new AppCore();
