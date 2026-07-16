/**
 * constants.js — 全局常量与配置
 *
 * ✅ Phase 0 已确认: BOSS直聘推荐页使用 iframe 架构
 *    主页: /web/chat/recommend (左侧导航壳)
 *    内容: /web/frame/recommend/ (iframe, 内含候选人卡片)
 *    沟通按钮: <button class="btn btn-greet">打招呼</button> (位于iframe内)
 */

// ============================================================================
// 页面 URL 匹配
// ============================================================================

/** 推荐页父页面 (导航壳) */
export const PARENT_PAGE_PATTERN = '/web/chat/recommend';
/** 推荐页 iframe (实际内容) */
export const IFRAME_PAGE_PATTERN = '/web/frame/recommend';

// ============================================================================
// CSS 选择器 (✅ Phase 0 已验证)
// ============================================================================

/** 推荐候选人卡片容器 — iframe内使用 */
export const CARD_SELECTORS = [
  'li[class*="candidate"]',
  'li[class*="geek"]',
  'li[class*="recommend"]',
  'div[class*="candidate"]',
  'div[class*="geek-card"]',
  'li',  // 最后的兜底
];

/** "打招呼"按钮 — ✅ 已确认: .btn.btn-greet */
export const GREET_BUTTON_SELECTORS = [
  '.btn.btn-greet',
  'button.btn-greet',
  '[class*="btn-greet"]',
];

/** 招呼语弹窗/对话框选择器 */
export const GREET_DIALOG_SELECTORS = [
  '[class*="dialog"]',
  '[class*="modal"]',
  '[class*="popup"]',
  '[class*="greet"]',
];

/** 招呼语发送按钮 */
export const GREET_SEND_SELECTORS = [
  'button[class*="send"]',
  'button[class*="confirm"]',
  'button[class*="primary"]',
  '.btn-send',
];

/** 验证码相关 */
export const CAPTCHA_SELECTORS = [
  '.geetest_panel',
  '.geetest_window',
  '.yoda-slider',
  '[class*="captcha"]',
  '[class*="verify"]',
];

/** 已沟通过的标记 */
export const ALREADY_GREETED_SELECTORS = [
  '[class*="greeted"]',
  '[class*="communicated"]',
  '[class*="disabled"]',
];

// ============================================================================
// Vue 实例访问路径
// ============================================================================

export const VUE_INSTANCE_PATHS = [
  '__vue__',
  '__vue_app__',
  '__vueParentComponent',
];

// ============================================================================
// 延迟配置 (毫秒)
// ============================================================================

export const DELAY_MEAN = 5500;
export const DELAY_STDEV = 1500;
export const DELAY_MIN = 3000;
export const DELAY_MAX = 12000;

export const SCROLL_WAIT_MIN = 300;
export const SCROLL_WAIT_MAX = 800;
export const DIALOG_WAIT_MIN = 500;
export const DIALOG_WAIT_MAX = 1500;
export const EVENT_DELAY_MIN = 10;
export const EVENT_DELAY_MAX = 50;
export const BACKOFF_BASE = 2;
export const BACKOFF_MAX = 60000;
export const IDLE_ACTION_PROBABILITY = 0.15;

// ============================================================================
// 限制
// ============================================================================

export const DAILY_GREET_LIMIT = 100;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_PER_HOUR = 30;

// ============================================================================
// localStorage 键名
// ============================================================================

export const STORAGE_KEY_STATE = 'boss_auto_state';
export const STORAGE_KEY_CONFIG = 'boss_auto_config';
export const STORAGE_KEY_LOG = 'boss_auto_log';

// ============================================================================
// 事件
// ============================================================================

export const EVENTS = {
  START: 'boss:start',
  PAUSE: 'boss:pause',
  RESUME: 'boss:resume',
  STOP: 'boss:stop',
  CARD_PROCESSED: 'boss:card-processed',
  CAPTCHA_DETECTED: 'boss:captcha-detected',
  CAPTCHA_RESOLVED: 'boss:captcha-resolved',
  ERROR: 'boss:error',
  LIMIT_REACHED: 'boss:limit-reached',
  STATE_CHANGED: 'boss:state-changed',
  DB_UPDATED: 'boss:db-updated',
  LOG: 'boss:log',
};

export const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CAPTCHA: 'CAPTCHA',
};

export const RUN_STATES = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
};
