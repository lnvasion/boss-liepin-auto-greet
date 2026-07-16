/**
 * state-manager.js — 状态持久化管理器
 *
 * 使用 localStorage 保存运行状态，支持页面刷新后恢复
 */

import { STORAGE_KEY_STATE, STORAGE_KEY_CONFIG, RUN_STATES } from './constants.js';
import { logger } from './logger.js';

/**
 * 默认状态结构
 */
const DEFAULT_STATE = {
  processedCandidates: [],    // 已处理候选人UID列表
  currentIndex: 0,           // 当前处理到的索引
  sessionStartTime: null,    // 会话开始时间
  totalGreeted: 0,           // 本次已沟通总数
  runState: RUN_STATES.IDLE, // 当前运行状态
  failureCount: 0,           // 连续失败计数
  captchaCount: 0,           // 验证码触发次数
  lastActionTime: null,      // 上一次操作时间
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  minDelay: 3000,            // 最小延迟 (ms)
  maxDelay: 8000,            // 最大延迟 (ms)
  autoScroll: true,          // 自动滚动
  dryRun: true,              // Dry-run 演练模式（默认开启）
  greetingTemplate: '',      // 招呼语模板（空=使用默认）
  maxPerSession: 50,         // 每次会话最多沟通数
};

class StateManager {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.config = { ...DEFAULT_CONFIG };
    this._initialized = false;
  }

  /**
   * 初始化：从 localStorage 恢复状态
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    // 恢复状态
    try {
      const savedState = localStorage.getItem(STORAGE_KEY_STATE);
      if (savedState) {
        const parsed = JSON.parse(savedState);
        this.state = { ...DEFAULT_STATE, ...parsed };
        logger.debug('已恢复上次保存的状态', {
          processedCount: this.state.processedCandidates.length,
          currentIndex: this.state.currentIndex,
        });
      }
    } catch (e) {
      logger.warn('状态恢复失败，使用默认状态', e.message);
      this.state = { ...DEFAULT_STATE };
    }

    // 恢复配置
    try {
      const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
        logger.debug('已恢复配置', { dryRun: this.config.dryRun, delay: `${this.config.minDelay}-${this.config.maxDelay}ms` });
      }
    } catch (e) {
      logger.warn('配置恢复失败，使用默认配置');
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * 持久化当前状态到 localStorage
   */
  persist() {
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(this.state));
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    } catch (e) {
      logger.error('状态保存失败', e.message);
    }
  }

  // ---- 状态读写 ----

  getRunState() { return this.state.runState; }
  setRunState(runState) {
    this.state.runState = runState;
    this.persist();
  }

  getCurrentIndex() { return this.state.currentIndex; }
  setCurrentIndex(idx) {
    this.state.currentIndex = idx;
    this.persist();
  }

  getTotalGreeted() { return this.state.totalGreeted; }
  incrementGreeted() {
    this.state.totalGreeted++;
    this.state.lastActionTime = Date.now();
    this.persist();
  }

  getProcessedCandidates() { return [...this.state.processedCandidates]; }

  /**
   * 标记候选人已处理
   */
  markProcessed(candidateId) {
    if (!this.state.processedCandidates.includes(candidateId)) {
      this.state.processedCandidates.push(candidateId);
      this.persist();
    }
  }

  /**
   * 检查候选人是否已处理
   */
  isProcessed(candidateId) {
    return this.state.processedCandidates.includes(candidateId);
  }

  getFailureCount() { return this.state.failureCount; }
  incrementFailure() {
    this.state.failureCount++;
    this.persist();
  }
  resetFailure() {
    this.state.failureCount = 0;
    this.persist();
  }

  getCaptchaCount() { return this.state.captchaCount; }
  incrementCaptcha() {
    this.state.captchaCount++;
    this.persist();
  }

  // ---- 配置读写 ----

  getConfig() { return { ...this.config }; }

  isDryRun() { return this.config.dryRun; }
  setDryRun(enabled) {
    this.config.dryRun = enabled;
    this.persist();
    logger.info(`Dry-run 模式: ${enabled ? '开启 (演练)' : '关闭 (真实发送)'}`);
  }

  getMinDelay() { return this.config.minDelay; }
  getMaxDelay() { return this.config.maxDelay; }
  setDelayRange(min, max) {
    this.config.minDelay = min;
    this.config.maxDelay = max;
    this.persist();
  }

  getGreetingTemplate() { return this.config.greetingTemplate; }
  setGreetingTemplate(template) {
    this.config.greetingTemplate = template;
    this.persist();
  }

  getMaxPerSession() { return this.config.maxPerSession; }

  hasReachedLimit() {
    return this.state.totalGreeted >= this.config.maxPerSession;
  }

  // ---- 会话管理 ----

  /**
   * 开始新会话
   */
  startSession() {
    this.state.sessionStartTime = Date.now();
    this.state.totalGreeted = 0;
    this.state.failureCount = 0;
    this.state.captchaCount = 0;
    this.setRunState(RUN_STATES.RUNNING);
    logger.info('会话已开始', { dryRun: this.config.dryRun, maxPerSession: this.config.maxPerSession });
    this.persist();
  }

  /**
   * 重置所有状态（清空已处理列表）
   */
  resetAll() {
    this.state = { ...DEFAULT_STATE };
    this.persist();
    logger.info('所有状态已重置');
  }

  /**
   * 导出状态（用于备份）
   */
  exportState() {
    return JSON.stringify({
      state: this.state,
      config: this.config,
      exportTime: new Date().toISOString(),
    }, null, 2);
  }

  /**
   * 导入状态
   */
  importState(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.state) this.state = { ...DEFAULT_STATE, ...data.state };
      if (data.config) this.config = { ...DEFAULT_CONFIG, ...data.config };
      this.persist();
      logger.success('状态导入成功');
      return true;
    } catch (e) {
      logger.error('状态导入失败', e.message);
      return false;
    }
  }
}

// 单例
export const stateManager = new StateManager();
