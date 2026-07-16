/**
 * constants.js — 猎聘推荐页自动沟通配置
 */
export const PAGE_URL_PATTERN = '/recommend';

// 候选人卡片容器选择器
export const CARD_SELECTORS = [
  '.xpath-resume-item-wrap',
  '.newResumeItemWrap--YmIxZ',
  '[class*="resumeItemWrap"]',
  '[class*="newResumeItem"]',
];

// "立即沟通"按钮选择器
export const GREET_BUTTON_SELECTORS = [
  'button.ant-lpt-btn-primary.ant-lpt-teno-btn',
  '[data-tlg-elem-id*="chat_btn"]',
];

// 已沟通标记选择器
export const ALREADY_GREETED_SELECTORS = [
  '[class*="greeted"]',
  '[class*="communicated"]',
  '[class*="disabled"]',
];

// React Fiber key 模式
export const REACT_INTERNAL_KEYS = [
  '__reactInternalInstance$',
  '__reactFiber$',
];

// 高斯延迟参数
export const DELAY_MEAN = 5500;
export const DELAY_STDEV = 1500;
export const DELAY_MIN = 3000;
export const DELAY_MAX = 12000;

export const SCROLL_WAIT_MIN = 300;
export const SCROLL_WAIT_MAX = 800;
export const EVENT_DELAY_MIN = 10;
export const EVENT_DELAY_MAX = 50;
export const BACKOFF_MAX = 60000;
export const IDLE_ACTION_PROBABILITY = 0.15;

export const MAX_CONSECUTIVE_FAILURES = 5;

// Storage keys
export const STORAGE_KEY_STATE = 'liepin_auto_state';
export const STORAGE_KEY_CONFIG = 'liepin_auto_config';

// Events
export const EVENTS = {
  START: 'liepin:start',
  PAUSE: 'liepin:pause',
  RESUME: 'liepin:resume',
  STOP: 'liepin:stop',
  CARD_PROCESSED: 'liepin:card-processed',
  CAPTCHA_DETECTED: 'liepin:captcha-detected',
  CAPTCHA_RESOLVED: 'liepin:captcha-resolved',
  ERROR: 'liepin:error',
  LIMIT_REACHED: 'liepin:limit-reached',
  STATE_CHANGED: 'liepin:state-changed',
  DB_UPDATED: 'liepin:db-updated',
  LOG: 'liepin:log',
};

export const LOG_LEVELS = {
  DEBUG: 'DEBUG', INFO: 'INFO', SUCCESS: 'SUCCESS',
  WARN: 'WARN', ERROR: 'ERROR', CAPTCHA: 'CAPTCHA',
};

export const RUN_STATES = {
  IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped',
};
