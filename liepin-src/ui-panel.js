/**
 * ui-panel.js — 浮动控制面板 (猎聘版)
 */
import { EVENTS, RUN_STATES } from './constants.js';
import { logger } from './logger.js';
import { stateManager } from './state-manager.js';
import { candidateDB } from './database.js';

class UIPanel {
  constructor() {
    this.container = null;
    this.progressBar = null;
    this.statusText = null;
    this.logContainer = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this._eventBus = null;
    this.panelWidth = 320;
    this.panelHeight = 480;
    this.isMinimized = false;
  }

  mount(eventBus) {
    this._eventBus = eventBus;
    if (document.getElementById('liepin-auto-panel')) return;
    this.container = this._buildPanel();
    document.body.appendChild(this.container);
    logger.info('控制面板已加载');
    this.updateProgress();
    this.updateStatus(RUN_STATES.IDLE);
    this._subscribeEvents();
  }

  _buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'liepin-auto-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '80px', right: '20px',
      width: this.panelWidth + 'px', height: this.panelHeight + 'px',
      minWidth: '280px', minHeight: '300px',
      backgroundColor: '#fff', borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      zIndex: '99999', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      fontSize: '13px', color: '#333', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', border: '1px solid #e8e8e8',
      userSelect: 'none',
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '10px 14px', background: 'linear-gradient(135deg, #1677ff, #0958d9)',
      color: '#fff', fontWeight: '600', fontSize: '14px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'move',
    });
    header.innerHTML = '<span>🔍 猎聘自动沟通</span><span>' +
      '<button id="liepin-auto-min" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">−</button>' +
      '<button id="liepin-auto-cls" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">×</button></span>';
    header.addEventListener('mousedown', this._onDragStart.bind(this));
    document.addEventListener('mousemove', this._onDragMove.bind(this));
    document.addEventListener('mouseup', this._onDragEnd.bind(this));

    // Body
    const body = document.createElement('div');
    body.id = 'liepin-auto-body';
    Object.assign(body.style, { padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: '1' });

    // Status
    this.statusText = document.createElement('div');
    Object.assign(this.statusText.style, {
      textAlign: 'center', padding: '6px 12px', borderRadius: '6px',
      fontSize: '12px', fontWeight: '500', background: '#f0f0f0',
    });
    this.statusText.textContent = '就绪';

    // Progress
    const progressSection = document.createElement('div');
    progressSection.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px;"><span>沟通进度</span><span><span id="liepin-auto-progress">0/' + stateManager.getMaxPerSession() + '</span> <input id="liepin-auto-max" type="number" min="1" max="200" value="' + stateManager.getMaxPerSession() + '" style="width:42px;font-size:11px;border:1px solid #d9d9d9;border-radius:3px;padding:1px 4px;text-align:center;" title="每日上限"></span></div>';
    const progressBg = document.createElement('div');
    Object.assign(progressBg.style, { width: '100%', height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' });
    this.progressBar = document.createElement('div');
    Object.assign(this.progressBar.style, { width: '0%', height: '100%', background: 'linear-gradient(90deg,#1677ff,#69b1ff)', borderRadius: '3px', transition: 'width 0.3s' });
    progressBg.appendChild(this.progressBar);
    progressSection.appendChild(progressBg);

    // Buttons
    const btnGroup = document.createElement('div');
    Object.assign(btnGroup.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' });
    btnGroup.appendChild(this._btn('▶ 开始', '#1677ff', () => this._eventBus?.emit(EVENTS.START)));
    btnGroup.appendChild(this._btn('⏸ 暂停', '#fa8c16', () => this._eventBus?.emit(EVENTS.PAUSE)));
    btnGroup.appendChild(this._btn('▶ 继续', '#52c41a', () => this._eventBus?.emit(EVENTS.RESUME)));
    btnGroup.appendChild(this._btn('⏹ 停止', '#ff4d4f', () => this._eventBus?.emit(EVENTS.STOP)));

    // Dry-run toggle
    const toggleRow = document.createElement('div');
    Object.assign(toggleRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0' });
    toggleRow.innerHTML = '<span style="font-size:12px;">🔰 Dry-run (演练模式)</span>';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox'; toggle.checked = stateManager.isDryRun();
    toggle.addEventListener('change', () => stateManager.setDryRun(toggle.checked));
    toggleRow.appendChild(toggle);

    // Speed slider
    const speedRow = document.createElement('div');
    speedRow.innerHTML = '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span>操作间隔</span><span id="liepin-auto-delay-label">' + (stateManager.getMinDelay()/1000) + '–' + (stateManager.getMaxDelay()/1000) + 's</span></div>';
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range'; speedSlider.min = '2000'; speedSlider.max = '20000';
    speedSlider.value = stateManager.getMaxDelay(); speedSlider.step = '500';
    Object.assign(speedSlider.style, { width: '100%', cursor: 'pointer' });
    speedSlider.addEventListener('input', () => {
      const max = parseInt(speedSlider.value);
      const min = Math.max(2000, max - 5000);
      stateManager.setDelayRange(min, max);
      const label = document.getElementById('liepin-auto-delay-label');
      if (label) label.textContent = (min/1000).toFixed(1) + '–' + (max/1000).toFixed(1) + 's';
    });
    speedRow.appendChild(speedSlider);

    // DB stats + Export
    const dbRow = document.createElement('div');
    Object.assign(dbRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' });
    dbRow.innerHTML = '<span id="liepin-auto-db">📊 记录: 加载中...</span><span></span>';
    const exportSpan = dbRow.querySelector('span:last-child');
    const csvBtn = this._smallBtn('CSV', '#1677ff', () => candidateDB.download('csv'));
    const jsonBtn = this._smallBtn('JSON', '#52c41a', () => candidateDB.download('json'));
    exportSpan.appendChild(csvBtn);
    exportSpan.appendChild(jsonBtn);

    // Log
    this.logContainer = document.createElement('div');
    Object.assign(this.logContainer.style, {
      maxHeight: '100px', overflowY: 'auto', background: '#fafafa',
      borderRadius: '6px', padding: '6px', fontSize: '11px',
      fontFamily: 'monospace', lineHeight: '1.4', flex: '1',
    });
    this.logContainer.textContent = '等待操作...';

    body.appendChild(this.statusText);
    body.appendChild(progressSection);
    body.appendChild(btnGroup);
    body.appendChild(toggleRow);
    body.appendChild(speedRow);
    body.appendChild(dbRow);
    body.appendChild(this.logContainer);

    panel.appendChild(header);
    panel.appendChild(body);

    // Resize handle
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

    // 上限输入
    const maxInput = document.getElementById('liepin-auto-max');
    if (maxInput) {
      maxInput.addEventListener('change', () => {
        const v = parseInt(maxInput.value) || 30;
        const clamped = Math.max(1, Math.min(200, v));
        stateManager.setMaxPerSession(clamped);
        maxInput.value = clamped;
        this.updateProgress();
      });
    }

    header.querySelector('#liepin-auto-min').addEventListener('click', (e) => { e.stopPropagation(); this._toggleMinimize(); });
    header.querySelector('#liepin-auto-cls').addEventListener('click', (e) => { e.stopPropagation(); this._eventBus?.emit(EVENTS.STOP); panel.style.display = 'none'; });

    return panel;
  }

  _btn(text, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, { padding: '8px', background: color, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '500' });
    btn.addEventListener('click', onClick);
    return btn;
  }

  _smallBtn(text, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, { background: color, color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px', marginLeft: '4px' });
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  _toggleMinimize() {
    const body = document.getElementById('liepin-auto-body');
    if (!body) return;
    this.isMinimized = !this.isMinimized;
    body.style.display = this.isMinimized ? 'none' : '';
    this.container.style.height = this.isMinimized ? 'auto' : this.panelHeight + 'px';
  }

  _resizeStart = { x: 0, y: 0, w: 320, h: 480 };
  _isResizing = false;

  _onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    this._isResizing = true;
    this._resizeStart = { x: e.clientX, y: e.clientY, w: this.panelWidth, h: this.panelHeight };
  }

  _onResizeMove(e) {
    if (!this._isResizing) return;
    const dx = e.clientX - this._resizeStart.x;
    const dy = e.clientY - this._resizeStart.y;
    this.panelWidth = Math.max(280, this._resizeStart.w + dx);
    this.panelHeight = Math.max(300, this._resizeStart.h + dy);
    this.container.style.width = this.panelWidth + 'px';
    this.container.style.height = this.panelHeight + 'px';
  }

  _onResizeEnd() {
    this._isResizing = false;
  }

  updateStatus(state) {
    if (!this.statusText) return;
    const s = state || stateManager.getRunState();
    const cfgs = {
      [RUN_STATES.IDLE]: { text: '⏳ 就绪 - 等待开始', bg: '#f0f0f0', color: '#666' },
      [RUN_STATES.RUNNING]: { text: '🟢 运行中...', bg: '#f6ffed', color: '#52c41a' },
      [RUN_STATES.PAUSED]: { text: '🟡 已暂停', bg: '#fffbe6', color: '#faad14' },
      [RUN_STATES.STOPPED]: { text: '⏹ 已停止', bg: '#fff2f0', color: '#ff4d4f' },
    };
    const cfg = cfgs[s] || cfgs[RUN_STATES.IDLE];
    this.statusText.textContent = cfg.text;
    this.statusText.style.background = cfg.bg;
    this.statusText.style.color = cfg.color;
  }

  updateProgress() {
    const greeted = stateManager.getTotalGreeted();
    const total = stateManager.getMaxPerSession();
    const el = document.getElementById('liepin-auto-progress');
    if (el) el.textContent = `${greeted}/${total}`;
    if (this.progressBar) this.progressBar.style.width = `${Math.min(100, greeted/total*100)}%`;
  }

  appendLog(entry) {
    if (!this.logContainer) return;
    const colors = { DEBUG: '#999', INFO: '#333', SUCCESS: '#52c41a', WARN: '#faad14', ERROR: '#ff4d4f', CAPTCHA: '#d4380d' };
    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN');
    const line = document.createElement('div');
    line.style.color = colors[entry.level] || '#333';
    line.textContent = `[${time}] ${entry.message}`;
    this.logContainer.appendChild(line);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  _subscribeEvents() {
    const bus = this._eventBus;
    if (!bus) return;
    bus.on(EVENTS.STATE_CHANGED, (s) => this.updateStatus(s));
    bus.on(EVENTS.CARD_PROCESSED, () => this.updateProgress());
    bus.on(EVENTS.LOG, (e) => this.appendLog(e));
    bus.on(EVENTS.DB_UPDATED, () => this._updateDBStats());
    logger.onLog((e) => this.appendLog(e));
    this._updateDBStats();
  }

  _updateDBStats() {
    candidateDB.load();
    const el = document.getElementById('liepin-auto-db');
    if (el) el.textContent = `📊 总${candidateDB.count()}条 / 今日${candidateDB.todayCount()}条`;
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
    if (this.isDragging) { this.isDragging = false; this.container.style.transition = ''; }
  }

  destroy() {
    if (this.container) { this.container.remove(); this.container = null; }
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  }
}

export const uiPanel = new UIPanel();
