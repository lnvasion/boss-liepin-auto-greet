/**
 * ui-panel.js — 浮动控制面板UI
 *
 * 在BOSS直聘页面上注入一个可拖拽的控制面板
 * 纯DOM构建，不引入任何框架依赖
 */
import { EVENTS, RUN_STATES } from './constants.js';
import { logger } from './logger.js';
import { stateManager } from './state-manager.js';
import { candidateDB } from './database.js';
import { buildProfile, loadProfile, hasProfile, getProfileSummary, saveProfile } from './intention-learner.js';
import { getMinScore, setMinScore } from './candidate-scorer.js';
import { cardScanner } from './card-scanner.js';

class UIPanel {
  constructor() {
    this.container = null;
    this.logContainer = null;
    this.progressBar = null;
    this.statusText = null;
    this.isMinimized = false;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.isResizing = false;
    this.resizeStart = { x: 0, y: 0, w: 320, h: 500 };
    this.panelWidth = 320;
    this.panelHeight = 500;
    this._eventBus = null;
  }

  /**
   * 创建并注入控制面板
   * @param {object} eventBus - 事件总线
   */
  mount(eventBus) {
    this._eventBus = eventBus;

    // 避免重复注入
    if (document.getElementById('boss-auto-panel')) return;

    this.container = this._buildPanel();
    document.body.insertAdjacentElement('beforeend', this.container);

    // 通知用户
    logger.info('控制面板已加载');

    // 更新初始状态
    this.updateProgress();
    this.updateStatus(RUN_STATES.IDLE);

    // 订阅事件
    this._subscribeEvents();
  }

  /**
   * 构建面板DOM
   */
  _buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'boss-auto-panel';

    // 样式：卡片风格，右上角浮动
    Object.assign(panel.style, {
      position: 'fixed',
      top: '80px',
      right: '20px',
      width: this.panelWidth + 'px',
      maxHeight: 'none',
      height: this.panelHeight + 'px',
      minWidth: '280px',
      minHeight: '300px',
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1)',
      zIndex: '99999',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      color: '#333',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid #e8e8e8',
      userSelect: 'none',
      transition: 'opacity 0.2s',
    });

    // ---- 标题栏 (可拖拽) ----
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '12px 16px',
      background: 'linear-gradient(135deg, #1677ff, #0958d9)',
      color: '#fff',
      fontWeight: '600',
      fontSize: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'move',
    });
    header.innerHTML = `
      <span>🤖 BOSS 自动沟通</span>
      <span>
        <button id="boss-auto-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">−</button>
        <button id="boss-auto-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">×</button>
      </span>
    `;

    // 拖拽事件
    header.addEventListener('mousedown', this._onDragStart.bind(this));
    document.addEventListener('mousemove', this._onDragMove.bind(this));
    document.addEventListener('mouseup', this._onDragEnd.bind(this));

    // ---- 内容区 ----
    const body = document.createElement('div');
    body.id = 'boss-auto-body';
    Object.assign(body.style, {
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      overflowY: 'auto',
    });

    // 状态显示
    this.statusText = document.createElement('div');
    Object.assign(this.statusText.style, {
      textAlign: 'center',
      padding: '6px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: '500',
      background: '#f0f0f0',
    });
    this.statusText.textContent = '就绪';

    // 进度条
    const progressSection = document.createElement('div');
    progressSection.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;"><span>沟通进度</span><span id="boss-auto-progress-text">0 / 0</span></div>';

    const progressBg = document.createElement('div');
    Object.assign(progressBg.style, {
      width: '100%', height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden',
    });
    this.progressBar = document.createElement('div');
    Object.assign(this.progressBar.style, {
      width: '0%', height: '100%', background: 'linear-gradient(90deg, #1677ff, #69b1ff)',
      borderRadius: '3px', transition: 'width 0.3s',
    });
    progressBg.appendChild(this.progressBar);
    progressSection.appendChild(progressBg);

    // 按钮组
    const buttonGroup = document.createElement('div');
    Object.assign(buttonGroup.style, {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px',
    });

    const btnStart = this._createButton('▶ 开始', '#1677ff', () => this._eventBus?.emit(EVENTS.START));
    const btnPause = this._createButton('⏸ 暂停', '#fa8c16', () => this._eventBus?.emit(EVENTS.PAUSE));
    const btnResume = this._createButton('▶ 继续', '#52c41a', () => this._eventBus?.emit(EVENTS.RESUME));
    const btnStop = this._createButton('⏹ 停止', '#ff4d4f', () => this._eventBus?.emit(EVENTS.STOP));

    buttonGroup.appendChild(btnStart);
    buttonGroup.appendChild(btnPause);
    buttonGroup.appendChild(btnResume);
    buttonGroup.appendChild(btnStop);

    // Dry-run 开关
    const toggleRow = document.createElement('div');
    Object.assign(toggleRow.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0',
    });
    const toggleLabel = document.createElement('span');
    toggleLabel.textContent = '🔰 Dry-run (演练模式)';
    toggleLabel.style.fontSize = '12px';
    const toggleSwitch = document.createElement('input');
    toggleSwitch.type = 'checkbox';
    toggleSwitch.checked = stateManager.isDryRun();
    toggleSwitch.addEventListener('change', () => {
      stateManager.setDryRun(toggleSwitch.checked);
      this.updateStatus();
    });
    Object.assign(toggleSwitch.style, { cursor: 'pointer' });
    toggleRow.appendChild(toggleLabel);
    toggleRow.appendChild(toggleSwitch);

    // 数据库统计 + 导出
    const dbRow = document.createElement('div');
    Object.assign(dbRow.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0', borderTop: '1px solid #f0f0f0',
      fontSize: '12px',
    });
    const dbStats = document.createElement('span');
    dbStats.id = 'boss-auto-db-stats';
    dbStats.textContent = '📊 记录: 加载中...';
    dbRow.appendChild(dbStats);

    const exportBtns = document.createElement('span');
    const csvBtn = document.createElement('button');
    csvBtn.textContent = 'CSV';
    Object.assign(csvBtn.style, {
      background: '#1677ff', color: '#fff', border: 'none', borderRadius: '4px',
      padding: '2px 8px', cursor: 'pointer', fontSize: '11px', marginLeft: '4px',
    });
    csvBtn.addEventListener('click', (e) => { e.stopPropagation(); candidateDB.download('csv'); });
    const jsonBtn = document.createElement('button');
    jsonBtn.textContent = 'JSON';
    Object.assign(jsonBtn.style, {
      background: '#52c41a', color: '#fff', border: 'none', borderRadius: '4px',
      padding: '2px 8px', cursor: 'pointer', fontSize: '11px', marginLeft: '4px',
    });
    jsonBtn.addEventListener('click', (e) => { e.stopPropagation(); candidateDB.download('json'); });
    exportBtns.appendChild(csvBtn);
    exportBtns.appendChild(jsonBtn);
    dbRow.appendChild(exportBtns);

    // 速度设置
    const speedRow = document.createElement('div');
    speedRow.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span>操作间隔</span>
        <span id="boss-auto-delay-label">${stateManager.getMinDelay() / 1000}–${stateManager.getMaxDelay() / 1000}s</span>
      </div>
    `;
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.min = '2000';
    speedSlider.max = '20000';
    speedSlider.value = stateManager.getMaxDelay();
    speedSlider.step = '500';
    Object.assign(speedSlider.style, { width: '100%', cursor: 'pointer' });
    speedSlider.addEventListener('input', () => {
      const max = parseInt(speedSlider.value);
      const min = Math.max(2000, max - 5000);
      stateManager.setDelayRange(min, max);
      document.getElementById('boss-auto-delay-label').textContent =
        `${(min / 1000).toFixed(1)}–${(max / 1000).toFixed(1)}s`;
    });
    speedRow.appendChild(speedSlider);

    // 日志区
    const logHeader = document.createElement('div');
    Object.assign(logHeader.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px',
    });
    logHeader.innerHTML = '<span style="font-size:12px;font-weight:500;">📋 日志</span>';
    const copyLogBtn = document.createElement('button');
    copyLogBtn.textContent = '复制';
    Object.assign(copyLogBtn.style, {
      background: '#f0f0f0', border: '1px solid #d9d9d9', borderRadius: '4px',
      padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
    });
    copyLogBtn.addEventListener('click', () => {
      if (!this.logContainer) return;
      const lines = [];
      for (const child of this.logContainer.children) {
        if (child.textContent && child.textContent !== '等待操作...') {
          lines.push(child.textContent);
        }
      }
      if (lines.length === 0) return;
      navigator.clipboard?.writeText(lines.join('\n')).then(() => {
        copyLogBtn.textContent = '✅';
        setTimeout(() => { copyLogBtn.textContent = '复制'; }, 1500);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = lines.join('\n');
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        copyLogBtn.textContent = '✅';
        setTimeout(() => { copyLogBtn.textContent = '复制'; }, 1500);
      });
    });
    logHeader.appendChild(copyLogBtn);

    const logSection = document.createElement('div');
    Object.assign(logSection.style, {
      maxHeight: '120px', overflowY: 'auto',
      background: '#fafafa', borderRadius: '6px', padding: '8px',
      fontSize: '11px', fontFamily: 'monospace', lineHeight: '1.5',
    });
    this.logContainer = logSection;
    logSection.innerHTML = '<div style="color:#999;">等待操作...</div>';

    // 组装
    body.appendChild(this.statusText);
    body.appendChild(progressSection);
    body.appendChild(buttonGroup);
    body.appendChild(toggleRow);
    body.appendChild(dbRow);
    
    // 筛选画像
    const filterRow = document.createElement('div');
    Object.assign(filterRow.style, { padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: '12px' });
    const profile = loadProfile();
    const summary = getProfileSummary(profile);
    filterRow.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span>🎯 筛选画像</span><span id="boss-auto-profile-status">' + (summary ? '✅ ' + summary.candidateCount + '人画像' : '⚠ 未加载') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;gap:6px;"><span>分数线</span><input id="boss-auto-min-score" type="number" min="0" max="100" value="' + getMinScore() + '" style="width:42px;font-size:11px;border:1px solid #d9d9d9;border-radius:3px;padding:1px 4px;text-align:center;" title="最低分数线"><span>分</span><button id="boss-auto-learn" style="margin-left:auto;background:#1677ff;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;">学习画像</button></div>';
    body.appendChild(filterRow);
    body.appendChild(speedRow);
    body.appendChild(logHeader);
    body.appendChild(logSection);

    panel.appendChild(header);
    panel.appendChild(body);

    // 调整大小手柄
    const resizeHandle = document.createElement('div');
    Object.assign(resizeHandle.style, {
      position: 'absolute', bottom: '0', right: '0',
      width: '16px', height: '16px', cursor: 'nwse-resize',
      background: 'linear-gradient(135deg, transparent 50%, #ccc 50%)',
      borderRadius: '0 0 12px 0',
    });
    resizeHandle.addEventListener('mousedown', this._onResizeStart.bind(this));
    document.addEventListener('mousemove', this._onResizeMove.bind(this));
    document.addEventListener('mouseup', this._onResizeEnd.bind(this));
    panel.appendChild(resizeHandle);

    // 最小化按钮
    header.querySelector('#boss-auto-minimize').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    });

    // 关闭按钮
    header.querySelector('#boss-auto-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this._eventBus?.emit(EVENTS.STOP);
      panel.style.display = 'none';
    });
    
    // 筛选控件事件
    const scoreInput = document.getElementById('boss-auto-min-score');
    if (scoreInput) {
      scoreInput.addEventListener('change', () => {
        const v = parseInt(scoreInput.value) || 40;
        const clamped = Math.max(0, Math.min(100, v));
        setMinScore(clamped);
        scoreInput.value = clamped;
      });
    }
    const learnBtn = document.getElementById('boss-auto-learn');
    if (learnBtn) {
      learnBtn.addEventListener('click', () => {
        const cards = cardScanner.scanCards();
        if (cards.length === 0) {
          logger.warn('未找到候选人卡片，无法学习');
          return;
        }
        const newProfile = buildProfile(cards);
        if (newProfile) {
          saveProfile(newProfile);
          const summary = getProfileSummary(newProfile);
          const statusEl = document.getElementById('boss-auto-profile-status');
          if (statusEl && summary) statusEl.textContent = '✅ ' + summary.candidateCount + '人画像';
          logger.success('筛选画像已更新！分析 ' + newProfile.candidateCount + ' 人，关键技能: ' + (summary?.topSkills || ''));
          this.updateProgress();
        }
      });
    }
    

    return panel;
  }

  _createButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      padding: '8px 12px',
      background: color,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
      transition: 'opacity 0.2s',
    });
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
    return btn;
  }

  /**
   * 更新状态显示
   */
  updateStatus(state) {
    if (!this.statusText) return;
    const currentState = state || stateManager.getRunState();
    const configs = {
      [RUN_STATES.IDLE]: { text: '⏳ 就绪 - 等待开始', bg: '#f0f0f0', color: '#666' },
      [RUN_STATES.RUNNING]: { text: '🟢 运行中...', bg: '#f6ffed', color: '#52c41a' },
      [RUN_STATES.PAUSED]: { text: '🟡 已暂停', bg: '#fffbe6', color: '#faad14' },
      [RUN_STATES.STOPPED]: { text: '⏹ 已停止', bg: '#fff2f0', color: '#ff4d4f' },
    };
    const cfg = configs[currentState] || configs[RUN_STATES.IDLE];
    this.statusText.textContent = cfg.text;
    this.statusText.style.background = cfg.bg;
    this.statusText.style.color = cfg.color;
  }

  /**
   * 显示验证码警告
   */
  showCaptchaAlert() {
    if (!this.statusText) return;
    this.statusText.textContent = '🤖 检测到验证码！请手动完成滑动验证';
    this.statusText.style.background = '#fff2e8';
    this.statusText.style.color = '#d4380d';
    this.statusText.style.animation = 'boss-auto-blink 1s infinite';
    // 注入闪烁动画
    if (!document.getElementById('boss-auto-blink-style')) {
      const style = document.createElement('style');
      style.id = 'boss-auto-blink-style';
      style.textContent = `
        @keyframes boss-auto-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  hideCaptchaAlert() {
    this.statusText.style.animation = '';
    this.updateStatus(RUN_STATES.RUNNING);
  }

  /**
   * 更新进度显示
   */
  updateProgress() {
    const greeted = stateManager.getTotalGreeted();
    const total = stateManager.getMaxPerSession();
    const textEl = document.getElementById('boss-auto-progress-text');
    if (textEl) textEl.textContent = `${greeted} / ${total}`;
    if (this.progressBar) {
      this.progressBar.style.width = `${Math.min(100, (greeted / total) * 100)}%`;
    }
  }

  /**
   * 追加日志行到面板
   */
  appendLog(entry) {
    if (!this.logContainer) return;

    const colors = {
      DEBUG: '#999',
      INFO: '#333',
      SUCCESS: '#52c41a',
      WARN: '#faad14',
      ERROR: '#ff4d4f',
      CAPTCHA: '#d4380d',
    };

    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN');
    const line = document.createElement('div');
    line.style.color = colors[entry.level] || '#333';
    line.textContent = `[${time}] ${entry.message}`;
    this.logContainer.appendChild(line);

    // 自动滚动到底部
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // 保持最多50条可见
    while (this.logContainer.children.length > 50) {
      this.logContainer.removeChild(this.logContainer.firstChild);
    }
  }

  /**
   * 订阅事件
   */
  _subscribeEvents() {
    const bus = this._eventBus;
    if (!bus) return;

    bus.on(EVENTS.STATE_CHANGED, (state) => this.updateStatus(state));
    bus.on(EVENTS.CARD_PROCESSED, () => this.updateProgress());
    bus.on(EVENTS.CAPTCHA_DETECTED, () => this.showCaptchaAlert());
    bus.on(EVENTS.CAPTCHA_RESOLVED, () => this.hideCaptchaAlert());
    bus.on(EVENTS.LOG, (entry) => this.appendLog(entry));
    bus.on(EVENTS.DB_UPDATED, () => this.updateDBStats());

    logger.onLog((entry) => { this.appendLog(entry); });

    // 初始化数据库统计
    this.updateDBStats();
  }

  updateDBStats() {
    candidateDB.load();
    const total = candidateDB.count();
    const today = candidateDB.todayCount();
    const el = document.getElementById('boss-auto-db-stats');
    if (el) el.textContent = `📊 总${total}条 / 今日${today}条`;
  }

  /**
   * 折叠/展开面板
   */
  toggleMinimize() {
    const body = document.getElementById('boss-auto-body');
    if (!body) return;
    this.isMinimized = !this.isMinimized;
    body.style.display = this.isMinimized ? 'none' : '';
    this.container.style.height = this.isMinimized ? 'auto' : this.panelHeight + 'px';
  }

  _onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    this.isResizing = true;
    this.resizeStart = { x: e.clientX, y: e.clientY, w: this.panelWidth, h: this.panelHeight };
  }

  _onResizeMove(e) {
    if (!this.isResizing) return;
    const dx = e.clientX - this.resizeStart.x;
    const dy = e.clientY - this.resizeStart.y;
    this.panelWidth = Math.max(280, this.resizeStart.w + dx);
    this.panelHeight = Math.max(300, this.resizeStart.h + dy);
    this.container.style.width = this.panelWidth + 'px';
    this.container.style.height = this.panelHeight + 'px';
  }

  _onResizeEnd() {
    this.isResizing = false;
  }

  _onDragStart(e) {
    if (e.target.tagName === 'BUTTON') return;
    this.isDragging = true;
    const rect = this.container.getBoundingClientRect();
    this.dragOffset.x = e.clientX - rect.left;
    this.dragOffset.y = e.clientY - rect.top;
    this.container.style.transition = 'none';
  }

  _onDragMove(e) {
    if (!this.isDragging) return;
    this.container.style.left = (e.clientX - this.dragOffset.x) + 'px';
    this.container.style.top = (e.clientY - this.dragOffset.y) + 'px';
    this.container.style.right = 'auto';
  }

  _onDragEnd() {
    if (this.isDragging) {
      this.isDragging = false;
      this.container.style.transition = '';
    }
  }

  /**
   * 销毁面板
   */
  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  }
}

// 单例
export const uiPanel = new UIPanel();
