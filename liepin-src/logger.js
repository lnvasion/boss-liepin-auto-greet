/**
 * logger.js — 日志系统 (复用于猎聘)
 */
const MAX_BUFFER_SIZE = 500;

class Logger {
  constructor() {
    this.buffer = [];
    this.listeners = [];
    this.wsConnection = null;
  }

  onLog(callback) {
    this.listeners.push(callback);
    return () => { this.listeners = this.listeners.filter((cb) => cb !== callback); };
  }

  _notify(entry) {
    for (const cb of this.listeners) {
      try { cb(entry); } catch (e) { /* skip */ }
    }
  }

  _write(level, message, data) {
    const entry = { timestamp: Date.now(), level, message, data: data || null };
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
    this.buffer.push(entry);
    const prefix = { DEBUG: '🔍', INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', CAPTCHA: '🤖' }[level] || '';
    console.log(`[Liepin-Auto] ${prefix} ${message}`, data !== null ? data : '');
    this._notify(entry);
  }

  debug(m, d) { this._write('DEBUG', m, d); }
  info(m, d) { this._write('INFO', m, d); }
  success(m, d) { this._write('SUCCESS', m, d); }
  warn(m, d) { this._write('WARN', m, d); }
  error(m, d) { this._write('ERROR', m, d); }
  captcha(m, d) { this._write('CAPTCHA', m, d); }

  getRecent(n = 20) { return this.buffer.slice(-n); }
  getAll() { return [...this.buffer]; }
  exportJSON() { return JSON.stringify(this.buffer, null, 2); }
  exportText() {
    return this.buffer.map((e) => {
      const time = new Date(e.timestamp).toLocaleTimeString('zh-CN');
      return `[${time}] [${e.level}] ${e.message}`;
    }).join('\n');
  }
  connectWS(url = 'ws://localhost:9999') {
    try {
      this.wsConnection = new WebSocket(url);
      this.wsConnection.onopen = () => this.info('已连接到监控服务器');
      this.wsConnection.onerror = () => { this.wsConnection = null; };
    } catch (e) { /* optional */ }
  }
  clear() { this.buffer = []; }
}

export const logger = new Logger();
