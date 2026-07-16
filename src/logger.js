/**
 * logger.js — 日志系统
 *
 * 环形缓冲区，支持多级别日志、控制台输出、UI回调、JSON导出
 */
import { LOG_LEVELS, EVENTS } from './constants.js';

const MAX_BUFFER_SIZE = 500;

class Logger {
  constructor() {
    /** @type {Array<{timestamp: number, level: string, message: string, data?: any}>} */
    this.buffer = [];
    this.listeners = [];
    this.wsConnection = null;
  }

  /**
   * 添加日志监听器（供UI面板使用）
   */
  onLog(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  /**
   * 通知所有监听器
   */
  _notify(entry) {
    for (const cb of this.listeners) {
      try { cb(entry); } catch (e) { /* ignore listener errors */ }
    }
    // WebSocket 流式传输
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      try {
        this.wsConnection.send(JSON.stringify(entry));
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * 写入日志条目
   */
  _write(level, message, data) {
    const entry = {
      timestamp: Date.now(),
      level,
      message,
      data: data || null,
    };

    // 环形缓冲区
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }
    this.buffer.push(entry);

    // 控制台输出
    const consoleMethod = {
      [LOG_LEVELS.DEBUG]: 'log',
      [LOG_LEVELS.INFO]: 'info',
      [LOG_LEVELS.SUCCESS]: 'log',
      [LOG_LEVELS.WARN]: 'warn',
      [LOG_LEVELS.ERROR]: 'error',
      [LOG_LEVELS.CAPTCHA]: 'warn',
    }[level] || 'log';

    const prefix = {
      [LOG_LEVELS.DEBUG]: '🔍',
      [LOG_LEVELS.INFO]: 'ℹ️',
      [LOG_LEVELS.SUCCESS]: '✅',
      [LOG_LEVELS.WARN]: '⚠️',
      [LOG_LEVELS.ERROR]: '❌',
      [LOG_LEVELS.CAPTCHA]: '🤖',
    }[level] || '';

    console[consoleMethod](
      `[BOSS-Auto] ${prefix} ${message}`,
      data !== null ? data : ''
    );

    this._notify(entry);
  }

  debug(message, data) { this._write(LOG_LEVELS.DEBUG, message, data); }
  info(message, data) { this._write(LOG_LEVELS.INFO, message, data); }
  success(message, data) { this._write(LOG_LEVELS.SUCCESS, message, data); }
  warn(message, data) { this._write(LOG_LEVELS.WARN, message, data); }
  error(message, data) { this._write(LOG_LEVELS.ERROR, message, data); }
  captcha(message, data) { this._write(LOG_LEVELS.CAPTCHA, message, data); }

  /**
   * 获取最近 N 条日志
   */
  getRecent(n = 20) {
    return this.buffer.slice(-n);
  }

  /**
   * 获取所有日志
   */
  getAll() {
    return [...this.buffer];
  }

  /**
   * 导出为 JSON 字符串
   */
  exportJSON() {
    return JSON.stringify(this.buffer, null, 2);
  }

  /**
   * 导出为文本
   */
  exportText() {
    return this.buffer
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString('zh-CN');
        return `[${time}] [${e.level}] ${e.message}`;
      })
      .join('\n');
  }

  /**
   * 连接到本地 WebSocket 服务器（可选监控）
   */
  connectWS(url = 'ws://localhost:9999') {
    try {
      this.wsConnection = new WebSocket(url);
      this.wsConnection.onopen = () => this.info('已连接到监控服务器');
      this.wsConnection.onclose = () => this.debug('监控服务器连接已断开');
      this.wsConnection.onerror = () => {
        this.debug('无法连接监控服务器（可选功能，不影响使用）');
        this.wsConnection = null;
      };
    } catch (e) {
      this.debug('WebSocket 连接失败（可选功能，不影响使用）');
    }
  }

  /**
   * 清空日志
   */
  clear() {
    this.buffer = [];
  }
}

// 单例
export const logger = new Logger();
