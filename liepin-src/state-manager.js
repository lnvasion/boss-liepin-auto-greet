/**
 * state-manager.js — 状态管理 (猎聘版)
 */
import { RUN_STATES, STORAGE_KEY_STATE, STORAGE_KEY_CONFIG } from './constants.js';

const DEFAULT_STATE = {
  processedCandidates: [],
  sessionStartTime: null,
  totalGreeted: 0,
  runState: RUN_STATES.IDLE,
  failureCount: 0,
  captchaCount: 0,
  lastActionTime: null,
};

const DEFAULT_CONFIG = {
  minDelay: 3000,
  maxDelay: 8000,
  autoScroll: true,
  dryRun: true,
  greetingTemplate: '',
  maxPerSession: 30,
};

class StateManager {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.config = { ...DEFAULT_CONFIG };
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATE);
      if (saved) this.state = { ...DEFAULT_STATE, ...JSON.parse(saved) };
    } catch (e) { /* ignore */ }
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (saved) this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) { /* ignore */ }
  }

  persist() {
    try { localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(this.state)); } catch (e) {}
    try { localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config)); } catch (e) {}
  }

  getRunState() { return this.state.runState; }
  setRunState(s) { this.state.runState = s; this.persist(); }

  getTotalGreeted() { return this.state.totalGreeted; }
  incrementGreeted() { this.state.totalGreeted++; this.state.lastActionTime = Date.now(); this.persist(); }

  markProcessed(id) {
    if (!this.state.processedCandidates.includes(id)) {
      this.state.processedCandidates.push(id);
      this.persist();
    }
  }
  isProcessed(id) { return this.state.processedCandidates.includes(id); }

  getFailureCount() { return this.state.failureCount; }
  incrementFailure() { this.state.failureCount++; this.persist(); }
  resetFailure() { this.state.failureCount = 0; this.persist(); }

  isDryRun() { return this.config.dryRun; }
  setDryRun(v) { this.config.dryRun = v; this.persist(); }
  getMinDelay() { return this.config.minDelay; }
  getMaxDelay() { return this.config.maxDelay; }
  setDelayRange(min, max) { this.config.minDelay = min; this.config.maxDelay = max; this.persist(); }
  getGreetingTemplate() { return this.config.greetingTemplate; }
  getMaxPerSession() { return this.config.maxPerSession; }
  setMaxPerSession(n) { this.config.maxPerSession = n; this.persist(); }
  hasReachedLimit() { return this.state.totalGreeted >= this.config.maxPerSession; }

  startSession() {
    this.state.sessionStartTime = Date.now();
    this.state.totalGreeted = 0;
    this.state.failureCount = 0;
    this.state.captchaCount = 0;
    this.setRunState(RUN_STATES.RUNNING);
    this.persist();
  }

  resetAll() { this.state = { ...DEFAULT_STATE }; this.persist(); }
}

export const stateManager = new StateManager();
