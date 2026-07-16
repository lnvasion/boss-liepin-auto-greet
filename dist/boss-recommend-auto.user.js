// ==UserScript==
// @name         BOSS直聘推荐页自动沟通
// @namespace    https://github.com/boss-recommend-auto
// @version      0.1.0
// @description  在BOSS直聘推荐页面(web/chat/recommend)自动向推荐候选人发起打招呼
// @author       BOSS Auto Tools
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/chat/recommend?*
// @match        https://www.zhipin.com/web/frame/recommend*
// @match        https://www.zhipin.com/web/frame/recommend?*
// @icon         https://www.zhipin.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(() => {
  // src/constants.js
  var IFRAME_PAGE_PATTERN = "/web/frame/recommend";
  var CARD_SELECTORS = [
    'li[class*="candidate"]',
    'li[class*="geek"]',
    'li[class*="recommend"]',
    'div[class*="candidate"]',
    'div[class*="geek-card"]',
    "li"
    // 最后的兜底
  ];
  var GREET_DIALOG_SELECTORS = [
    '[class*="dialog"]',
    '[class*="modal"]',
    '[class*="popup"]',
    '[class*="greet"]'
  ];
  var GREET_SEND_SELECTORS = [
    'button[class*="send"]',
    'button[class*="confirm"]',
    'button[class*="primary"]',
    ".btn-send"
  ];
  var CAPTCHA_SELECTORS = [
    ".geetest_panel",
    ".geetest_window",
    ".yoda-slider",
    '[class*="captcha"]',
    '[class*="verify"]'
  ];
  var ALREADY_GREETED_SELECTORS = [
    '[class*="greeted"]',
    '[class*="communicated"]',
    '[class*="disabled"]'
  ];
  var VUE_INSTANCE_PATHS = [
    "__vue__",
    "__vue_app__",
    "__vueParentComponent"
  ];
  var DELAY_MEAN = 5500;
  var DELAY_STDEV = 1500;
  var DELAY_MIN = 3e3;
  var DELAY_MAX = 12e3;
  var SCROLL_WAIT_MIN = 300;
  var SCROLL_WAIT_MAX = 800;
  var EVENT_DELAY_MIN = 10;
  var EVENT_DELAY_MAX = 50;
  var BACKOFF_MAX = 6e4;
  var IDLE_ACTION_PROBABILITY = 0.15;
  var MAX_CONSECUTIVE_FAILURES = 5;
  var STORAGE_KEY_STATE = "boss_auto_state";
  var STORAGE_KEY_CONFIG = "boss_auto_config";
  var EVENTS = {
    START: "boss:start",
    PAUSE: "boss:pause",
    RESUME: "boss:resume",
    STOP: "boss:stop",
    CARD_PROCESSED: "boss:card-processed",
    CAPTCHA_DETECTED: "boss:captcha-detected",
    CAPTCHA_RESOLVED: "boss:captcha-resolved",
    ERROR: "boss:error",
    LIMIT_REACHED: "boss:limit-reached",
    STATE_CHANGED: "boss:state-changed",
    DB_UPDATED: "boss:db-updated",
    LOG: "boss:log"
  };
  var LOG_LEVELS = {
    DEBUG: "DEBUG",
    INFO: "INFO",
    SUCCESS: "SUCCESS",
    WARN: "WARN",
    ERROR: "ERROR",
    CAPTCHA: "CAPTCHA"
  };
  var RUN_STATES = {
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
    STOPPED: "stopped"
  };

  // src/logger.js
  var MAX_BUFFER_SIZE = 500;
  var Logger = class {
    constructor() {
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
        try {
          cb(entry);
        } catch (e) {
        }
      }
      if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
        try {
          this.wsConnection.send(JSON.stringify(entry));
        } catch (e) {
        }
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
        data: data || null
      };
      if (this.buffer.length >= MAX_BUFFER_SIZE) {
        this.buffer.shift();
      }
      this.buffer.push(entry);
      const consoleMethod = {
        [LOG_LEVELS.DEBUG]: "log",
        [LOG_LEVELS.INFO]: "info",
        [LOG_LEVELS.SUCCESS]: "log",
        [LOG_LEVELS.WARN]: "warn",
        [LOG_LEVELS.ERROR]: "error",
        [LOG_LEVELS.CAPTCHA]: "warn"
      }[level] || "log";
      const prefix = {
        [LOG_LEVELS.DEBUG]: "\u{1F50D}",
        [LOG_LEVELS.INFO]: "\u2139\uFE0F",
        [LOG_LEVELS.SUCCESS]: "\u2705",
        [LOG_LEVELS.WARN]: "\u26A0\uFE0F",
        [LOG_LEVELS.ERROR]: "\u274C",
        [LOG_LEVELS.CAPTCHA]: "\u{1F916}"
      }[level] || "";
      console[consoleMethod](
        `[BOSS-Auto] ${prefix} ${message}`,
        data !== null ? data : ""
      );
      this._notify(entry);
    }
    debug(message, data) {
      this._write(LOG_LEVELS.DEBUG, message, data);
    }
    info(message, data) {
      this._write(LOG_LEVELS.INFO, message, data);
    }
    success(message, data) {
      this._write(LOG_LEVELS.SUCCESS, message, data);
    }
    warn(message, data) {
      this._write(LOG_LEVELS.WARN, message, data);
    }
    error(message, data) {
      this._write(LOG_LEVELS.ERROR, message, data);
    }
    captcha(message, data) {
      this._write(LOG_LEVELS.CAPTCHA, message, data);
    }
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
      return this.buffer.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString("zh-CN");
        return `[${time}] [${e.level}] ${e.message}`;
      }).join("\n");
    }
    /**
     * 连接到本地 WebSocket 服务器（可选监控）
     */
    connectWS(url = "ws://localhost:9999") {
      try {
        this.wsConnection = new WebSocket(url);
        this.wsConnection.onopen = () => this.info("\u5DF2\u8FDE\u63A5\u5230\u76D1\u63A7\u670D\u52A1\u5668");
        this.wsConnection.onclose = () => this.debug("\u76D1\u63A7\u670D\u52A1\u5668\u8FDE\u63A5\u5DF2\u65AD\u5F00");
        this.wsConnection.onerror = () => {
          this.debug("\u65E0\u6CD5\u8FDE\u63A5\u76D1\u63A7\u670D\u52A1\u5668\uFF08\u53EF\u9009\u529F\u80FD\uFF0C\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF09");
          this.wsConnection = null;
        };
      } catch (e) {
        this.debug("WebSocket \u8FDE\u63A5\u5931\u8D25\uFF08\u53EF\u9009\u529F\u80FD\uFF0C\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF09");
      }
    }
    /**
     * 清空日志
     */
    clear() {
      this.buffer = [];
    }
  };
  var logger = new Logger();

  // src/state-manager.js
  var DEFAULT_STATE = {
    processedCandidates: [],
    // 已处理候选人UID列表
    currentIndex: 0,
    // 当前处理到的索引
    sessionStartTime: null,
    // 会话开始时间
    totalGreeted: 0,
    // 本次已沟通总数
    runState: RUN_STATES.IDLE,
    // 当前运行状态
    failureCount: 0,
    // 连续失败计数
    captchaCount: 0,
    // 验证码触发次数
    lastActionTime: null
    // 上一次操作时间
  };
  var DEFAULT_CONFIG = {
    minDelay: 3e3,
    // 最小延迟 (ms)
    maxDelay: 8e3,
    // 最大延迟 (ms)
    autoScroll: true,
    // 自动滚动
    dryRun: true,
    // Dry-run 演练模式（默认开启）
    greetingTemplate: "",
    // 招呼语模板（空=使用默认）
    maxPerSession: 50
    // 每次会话最多沟通数
  };
  var StateManager = class {
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
      try {
        const savedState = localStorage.getItem(STORAGE_KEY_STATE);
        if (savedState) {
          const parsed = JSON.parse(savedState);
          this.state = { ...DEFAULT_STATE, ...parsed };
          logger.debug("\u5DF2\u6062\u590D\u4E0A\u6B21\u4FDD\u5B58\u7684\u72B6\u6001", {
            processedCount: this.state.processedCandidates.length,
            currentIndex: this.state.currentIndex
          });
        }
      } catch (e) {
        logger.warn("\u72B6\u6001\u6062\u590D\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u72B6\u6001", e.message);
        this.state = { ...DEFAULT_STATE };
      }
      try {
        const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (savedConfig) {
          const parsed = JSON.parse(savedConfig);
          this.config = { ...DEFAULT_CONFIG, ...parsed };
          logger.debug("\u5DF2\u6062\u590D\u914D\u7F6E", { dryRun: this.config.dryRun, delay: `${this.config.minDelay}-${this.config.maxDelay}ms` });
        }
      } catch (e) {
        logger.warn("\u914D\u7F6E\u6062\u590D\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u914D\u7F6E");
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
        logger.error("\u72B6\u6001\u4FDD\u5B58\u5931\u8D25", e.message);
      }
    }
    // ---- 状态读写 ----
    getRunState() {
      return this.state.runState;
    }
    setRunState(runState) {
      this.state.runState = runState;
      this.persist();
    }
    getCurrentIndex() {
      return this.state.currentIndex;
    }
    setCurrentIndex(idx) {
      this.state.currentIndex = idx;
      this.persist();
    }
    getTotalGreeted() {
      return this.state.totalGreeted;
    }
    incrementGreeted() {
      this.state.totalGreeted++;
      this.state.lastActionTime = Date.now();
      this.persist();
    }
    getProcessedCandidates() {
      return [...this.state.processedCandidates];
    }
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
    getFailureCount() {
      return this.state.failureCount;
    }
    incrementFailure() {
      this.state.failureCount++;
      this.persist();
    }
    resetFailure() {
      this.state.failureCount = 0;
      this.persist();
    }
    getCaptchaCount() {
      return this.state.captchaCount;
    }
    incrementCaptcha() {
      this.state.captchaCount++;
      this.persist();
    }
    // ---- 配置读写 ----
    getConfig() {
      return { ...this.config };
    }
    isDryRun() {
      return this.config.dryRun;
    }
    setDryRun(enabled) {
      this.config.dryRun = enabled;
      this.persist();
      logger.info(`Dry-run \u6A21\u5F0F: ${enabled ? "\u5F00\u542F (\u6F14\u7EC3)" : "\u5173\u95ED (\u771F\u5B9E\u53D1\u9001)"}`);
    }
    getMinDelay() {
      return this.config.minDelay;
    }
    getMaxDelay() {
      return this.config.maxDelay;
    }
    setDelayRange(min, max) {
      this.config.minDelay = min;
      this.config.maxDelay = max;
      this.persist();
    }
    getGreetingTemplate() {
      return this.config.greetingTemplate;
    }
    setGreetingTemplate(template) {
      this.config.greetingTemplate = template;
      this.persist();
    }
    getMaxPerSession() {
      return this.config.maxPerSession;
    }
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
      logger.info("\u4F1A\u8BDD\u5DF2\u5F00\u59CB", { dryRun: this.config.dryRun, maxPerSession: this.config.maxPerSession });
      this.persist();
    }
    /**
     * 重置所有状态（清空已处理列表）
     */
    resetAll() {
      this.state = { ...DEFAULT_STATE };
      this.persist();
      logger.info("\u6240\u6709\u72B6\u6001\u5DF2\u91CD\u7F6E");
    }
    /**
     * 导出状态（用于备份）
     */
    exportState() {
      return JSON.stringify({
        state: this.state,
        config: this.config,
        exportTime: (/* @__PURE__ */ new Date()).toISOString()
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
        logger.success("\u72B6\u6001\u5BFC\u5165\u6210\u529F");
        return true;
      } catch (e) {
        logger.error("\u72B6\u6001\u5BFC\u5165\u5931\u8D25", e.message);
        return false;
      }
    }
  };
  var stateManager = new StateManager();

  // src/card-scanner.js
  var CardScanner = class {
    constructor() {
      this.seenIds = /* @__PURE__ */ new Set();
      this.currentCards = [];
      this._iframeDoc = null;
    }
    isInIframe() {
      return window.location.href.includes(IFRAME_PAGE_PATTERN);
    }
    _getIframeEl() {
      const iframes = document.querySelectorAll("iframe");
      for (const f of iframes) {
        if (f.src && f.src.includes(IFRAME_PAGE_PATTERN)) return f;
      }
      return null;
    }
    getTargetDocument() {
      if (this.isInIframe()) return document;
      if (this._iframeDoc) return this._iframeDoc;
      const f = this._getIframeEl();
      if (f) {
        try {
          this._iframeDoc = f.contentDocument || f.contentWindow?.document;
          if (this._iframeDoc) return this._iframeDoc;
        } catch (e) {
          logger.debug("iframe access error", e.message);
        }
      }
      return null;
    }
    getTargetWindow() {
      if (this.isInIframe()) return window;
      const f = this._getIframeEl();
      if (f && f.contentWindow) return f.contentWindow;
      return window;
    }
    waitForIframe(timeout = 15e3) {
      return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const doc = this.getTargetDocument();
          if (doc && doc.readyState === "complete") {
            const btns = doc.querySelectorAll(".btn.btn-greet");
            if (btns.length > 0) {
              logger.info("iframe ready, found " + btns.length + " greet buttons");
              resolve(doc);
              return;
            }
          }
          if (Date.now() - start > timeout) {
            logger.warn("iframe wait timeout");
            resolve(null);
            return;
          }
          setTimeout(check, 500);
        };
        check();
      });
    }
    /**
     * Scan cards in the target document (iframe or current page)
     */
    scanCards() {
      const targetDoc = this.getTargetDocument();
      if (!targetDoc) {
        logger.warn("No target document");
        return [];
      }
      let cardElements = this._findCardsByGreetButtons(targetDoc);
      if (cardElements.length === 0) {
        for (const selector of CARD_SELECTORS) {
          try {
            const elements = targetDoc.querySelectorAll(selector);
            if (elements.length > 0) {
              cardElements = Array.from(elements);
              logger.debug("selector " + selector + " matched " + elements.length);
              break;
            }
          } catch (e) {
          }
        }
      }
      this.currentCards = cardElements.map((el) => this._parseCard(el)).filter((card) => card !== null);
      this._enrichFromPageList(this.currentCards, targetDoc);
      for (const card of this.currentCards) {
        if (!this.seenIds.has(card.id)) {
          this.seenIds.add(card.id);
          logger.debug("found: " + card.name + " - " + (card.title || "").slice(0, 40));
        }
      }
      return this.currentCards;
    }
    /**
     * Find card containers by greet buttons
     */
    _findCardsByGreetButtons(doc) {
      const cards = /* @__PURE__ */ new Set();
      const greetBtns = doc.querySelectorAll(".btn.btn-greet");
      for (const btn of greetBtns) {
        let parent = btn.parentElement;
        for (let i = 0; i < 6 && parent; i++) {
          const tag = parent.tagName.toLowerCase();
          if (["li", "div", "section", "article"].includes(tag) && parent.offsetHeight > 80 && parent.offsetHeight < 500) {
            cards.add(parent);
            break;
          }
          parent = parent.parentElement;
        }
      }
      logger.info("found " + cards.size + " cards via greet buttons");
      return Array.from(cards);
    }
    getUnprocessedCards(isProcessed) {
      return this.currentCards.filter((card) => !isProcessed(card.id));
    }
    /**
     * Parse a single candidate card
     */
    _parseCard(element) {
      try {
        if (element.querySelector(".btn-job-top")) return null;
        const html = element.outerHTML || "";
        if (/<[^>]*>\d+-\d+K\s*</.test(html) && !element.querySelector(".btn.btn-greet")) return null;
        const greetButton = element.querySelector(".btn.btn-greet");
        if (!greetButton) return null;
        let name = "unknown";
        const spans = element.querySelectorAll("span");
        for (const s of spans) {
          const t = (s.textContent || "").trim();
          if (t.length >= 2 && t.length <= 8 && !t.includes("\u6C9F\u901A") && !t.includes("\u8054\u7CFB") && !t.includes("\u62DB\u547C") && !t.includes("K") && !t.includes("-") && !t.includes("@") && !t.includes("\u6D3B\u8DC3") && !t.includes("\u5728\u7EBF") && !t.includes("\u9762\u8BAE") && !t.includes("\u8BAE") && !/^\d+/.test(t) && !t.endsWith("\u5C81")) {
            name = t;
            break;
          }
        }
        if (name === "unknown") {
          const fullText2 = (element.textContent || "").trim();
          const parts = fullText2.split(/优势|@|期望|刚刚|在线/);
          const firstPart = parts[0].trim();
          name = firstPart.slice(0, 10).replace(/\s+/g, " ").trim() || "unknown";
        }
        let title = "";
        const fullText = (element.textContent || "").trim();
        const descMatch = fullText.match(/优势\s*(.+?)(?:@|$)/);
        if (descMatch) {
          title = descMatch[1].trim().slice(0, 60);
        }
        const alreadyGreeted = this._checkAlreadyGreeted(element);
        const id = this._generateId(element, name, title, "");
        return {
          element,
          id,
          name,
          title: title || "",
          description: title || "",
          company: "",
          greetButton,
          alreadyGreeted,
          vueInstance: this._findVueInstance(element),
          // 丰富字段 (后续由_enrichFromPageList填充)
          ageDesc: "",
          gender: "",
          workYears: "",
          degree: "",
          education: "",
          lastWork: "",
          expectLocation: "",
          cityName: "",
          activeTime: "",
          _pageData: null
        };
      } catch (e) {
        logger.debug("card parse error: " + e.message);
        return null;
      }
    }
    _checkAlreadyGreeted(cardElement) {
      for (const selector of ALREADY_GREETED_SELECTORS) {
        try {
          if (cardElement.querySelector(selector)) return true;
        } catch (e) {
        }
      }
      const greetBtn = cardElement.querySelector(".btn.btn-greet");
      if (greetBtn) {
        const text = greetBtn.textContent?.trim() || "";
        if (text.includes("\u5DF2\u6C9F\u901A") || text.includes("\u5DF2\u8054\u7CFB") || text.includes("\u7B49\u5F85\u56DE\u590D")) {
          return true;
        }
      }
      return false;
    }
    _generateId(element, name, title, company) {
      const dataId = element.getAttribute("data-id") || element.getAttribute("data-uid") || element.getAttribute("data-user-id") || element.getAttribute("data-encrypt-id");
      if (dataId) return dataId;
      const key = element.getAttribute("data-key") || element.getAttribute("key");
      if (key) return key;
      const str = name + "|" + title.slice(0, 20) + "|" + (element.outerHTML?.length || 0);
      return "card_" + this._simpleHash(str);
    }
    _simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash).toString(36);
    }
    _findVueInstance(element) {
      for (const path of VUE_INSTANCE_PATHS) {
        try {
          const inst = element[path];
          if (inst) return inst;
        } catch (e) {
        }
      }
      let parent = element.parentElement;
      for (let d = 0; d < 5 && parent; d++) {
        for (const path of VUE_INSTANCE_PATHS) {
          try {
            const inst = parent[path];
            if (inst) return inst;
          } catch (e) {
          }
        }
        parent = parent.parentElement;
      }
      return null;
    }
    /**
     * 从Vue组件 $props.pageList 丰富卡片数据
     */
    _enrichFromPageList(cards, targetDoc) {
      try {
        const cardList = targetDoc.querySelector(".card-list");
        if (!cardList || !cardList.__vue__) return;
        const inst = cardList.__vue__;
        const pageList = inst.$props?.pageList;
        if (!Array.isArray(pageList)) return;
        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          let entry = null;
          for (const e of pageList) {
            if (e.geekName === card.name) {
              entry = e;
              break;
            }
          }
          if (!entry && i < pageList.length) {
            entry = pageList[i];
            if (entry.geekName && entry.geekName.slice(0, 1) !== card.name.slice(0, 1)) {
              entry = null;
            }
          }
          if (!entry) continue;
          card._pageData = entry;
          if (!card.ageDesc) card.ageDesc = entry.ageDesc || entry.showAge || "";
          if (!card.gender) card.gender = entry.sexCode === 1 ? "\u7537" : entry.sexCode === 2 ? "\u5973" : entry.sexCode || "";
          if (!card.workYears) card.workYears = entry.workYearsShow || entry.geekWorkYear || "";
          if (!card.degree) card.degree = entry.geekDegree || entry.eduLevelShow || "";
          if (!card.education) {
            const edus = entry.showEdus || entry.geekEdus || [];
            if (edus.length > 0) {
              card.education = [edus[0].school, edus[0].major, edus[0].degreeName].filter(Boolean).join(" / ");
            }
          }
          if (!card.lastWork && entry.geekLastWork) {
            card.lastWork = [entry.geekLastWork.company, entry.geekLastWork.positionName].filter(Boolean).join(" \xB7 ");
          }
          if (!card.expectLocation) {
            card.expectLocation = entry.expectLocationName || entry.expectLocation || "";
          }
          if (!card.cityName) card.cityName = entry.cityName || "";
          if (!card.activeTime) card.activeTime = entry.activeTimeDesc || entry.activeStatus || "";
        }
      } catch (e) {
        logger.debug("_enrichFromPageList error: " + e.message);
      }
    }
    getAllCards() {
      return [...this.currentCards];
    }
    async waitForNewCards(timeout = 3e3) {
      const before = this.currentCards.length;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        this.scanCards();
        if (this.currentCards.length > before) {
          return this.currentCards.slice(before);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return [];
    }
  };
  var cardScanner = new CardScanner();

  // src/anti-detect.js
  function gaussianRandom(mean, stdev) {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2 * Math.log(Math.max(u, 1e-3))) * Math.cos(2 * Math.PI * v);
    return z * stdev + mean;
  }
  function humanDelay(min = DELAY_MIN, max = DELAY_MAX, mean = DELAY_MEAN, stdev = DELAY_STDEV) {
    const delay = Math.min(max, Math.max(min, Math.round(gaussianRandom(mean, stdev))));
    logger.debug(`\u5EF6\u8FDF ${delay}ms`, { delay, mean, stdev });
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
  function exponentialBackoff(attempt) {
    const delay = Math.min(BACKOFF_MAX, 1e3 * Math.pow(2, attempt));
    const jitter = delay * (0.75 + Math.random() * 0.5);
    const finalDelay = Math.round(jitter);
    logger.debug(`\u9000\u907F\u5EF6\u8FDF ${finalDelay}ms (attempt ${attempt + 1})`);
    return new Promise((resolve) => setTimeout(resolve, finalDelay));
  }
  async function humanScrollToElement(element, win = window) {
    if (!element) return;
    const thinkPause = SCROLL_WAIT_MIN + Math.random() * (SCROLL_WAIT_MAX - SCROLL_WAIT_MIN);
    await new Promise((r) => setTimeout(r, thinkPause));
    const rect = element.getBoundingClientRect();
    const targetScrollY = win.scrollY + rect.top - win.innerHeight * 0.3;
    win.scrollTo({ top: Math.max(0, targetScrollY), behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 500));
    if (Math.random() < 0.2) {
      const overshoot = 15 + Math.random() * 35;
      win.scrollBy({ top: overshoot, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 150));
      win.scrollBy({ top: -overshoot, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  async function dispatchHumanClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startX = rect.left + Math.random() * rect.width;
    const startY = rect.top - 50 - Math.random() * 100;
    element.dispatchEvent(new PointerEvent("pointerover", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy
    }));
    element.dispatchEvent(new MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy
    }));
    await new Promise((r) => setTimeout(r, EVENT_DELAY_MIN + Math.random() * EVENT_DELAY_MAX));
    element.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0
    }));
    element.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0
    }));
    await new Promise((r) => setTimeout(r, EVENT_DELAY_MIN + Math.random() * (EVENT_DELAY_MAX - EVENT_DELAY_MIN)));
    element.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0
    }));
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0
    }));
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    element.dispatchEvent(new PointerEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      button: 0
    }));
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      button: 0
    }));
  }
  async function randomIdleAction() {
    if (Math.random() > IDLE_ACTION_PROBABILITY) return;
    const action = Math.floor(Math.random() * 3);
    switch (action) {
      case 0: {
        const scrollAmount = 30 + Math.random() * 80;
        window.scrollBy({ top: scrollAmount, behavior: "smooth" });
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
        window.scrollBy({ top: -scrollAmount * (0.5 + Math.random() * 0.5), behavior: "smooth" });
        break;
      }
      case 1: {
        const midScroll = 200 + Math.random() * 400;
        window.scrollBy({ top: midScroll, behavior: "smooth" });
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
        window.scrollBy({ top: -midScroll, behavior: "smooth" });
        break;
      }
      case 2:
        logger.debug("\u968F\u673A\u7A7A\u95F2\uFF1A\u6682\u505C\u6D4F\u89C8");
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
        break;
    }
  }
  function setupCaptchaObserver(onCaptcha, onResolved, rootDoc = document) {
    let captchaActive = false;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const selector = CAPTCHA_SELECTORS.join(", ");
          const captchaEl = node.matches?.(selector) ? node : node.querySelector?.(selector);
          if (captchaEl && !captchaActive) {
            captchaActive = true;
            logger.captcha("\u68C0\u6D4B\u5230\u9A8C\u8BC1\u7801\uFF01\u9700\u8981\u4EBA\u5DE5\u5B8C\u6210", { element: captchaEl.className });
            onCaptcha?.(captchaEl);
          }
        }
        if (captchaActive) {
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const selector = CAPTCHA_SELECTORS.join(", ");
            const captchaEl = node.matches?.(selector) ? node : node.querySelector?.(selector);
            if (captchaEl) {
              captchaActive = false;
              logger.success("\u9A8C\u8BC1\u7801\u5DF2\u89E3\u9664");
              onResolved?.();
            }
          }
        }
      }
    });
    observer.observe(rootDoc.body, { childList: true, subtree: true });
    return {
      disconnect: () => observer.disconnect()
    };
  }
  function setupVisibilityHandler(onHidden, onVisible) {
    const handler = () => {
      if (document.visibilityState === "hidden") {
        logger.warn("\u6807\u7B7E\u9875\u5DF2\u5207\u6362\u5230\u540E\u53F0\uFF0C\u81EA\u52A8\u6682\u505C");
        onHidden?.();
      } else if (document.visibilityState === "visible") {
        logger.info("\u6807\u7B7E\u9875\u5DF2\u56DE\u5230\u524D\u53F0");
        onVisible?.();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return {
      disconnect: () => document.removeEventListener("visibilitychange", handler)
    };
  }
  function waitForElement(selector, timeout = 5e3, rootDoc = document) {
    return new Promise((resolve) => {
      const el = rootDoc.querySelector(selector);
      if (el) return resolve(el);
      const startTime = Date.now();
      const interval = setInterval(() => {
        const el2 = rootDoc.querySelector(selector);
        if (el2) {
          clearInterval(interval);
          resolve(el2);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          resolve(null);
        }
      }, 200);
    });
  }
  function waitForElementRemoval(selector, timeout = 1e4, rootDoc = document) {
    return new Promise((resolve) => {
      if (!rootDoc.querySelector(selector)) return resolve(true);
      const observer = new MutationObserver(() => {
        if (!rootDoc.querySelector(selector)) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(rootDoc.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    });
  }

  // src/database.js
  var DB_KEY = "boss_auto_records";
  var CandidateDatabase = class {
    constructor() {
      this.records = [];
      this._loaded = false;
    }
    /**
     * 加载已有记录
     */
    load() {
      if (this._loaded) return;
      this._loaded = true;
      try {
        if (typeof GM_getValue === "function") {
          const raw = GM_getValue(DB_KEY, "[]");
          this.records = typeof raw === "string" ? JSON.parse(raw) : raw;
        } else {
          const raw = localStorage.getItem(DB_KEY);
          this.records = raw ? JSON.parse(raw) : [];
        }
        logger.info("\u5DF2\u52A0\u8F7D " + this.records.length + " \u6761\u5386\u53F2\u6C9F\u901A\u8BB0\u5F55");
      } catch (e) {
        logger.warn("\u6570\u636E\u5E93\u52A0\u8F7D\u5931\u8D25\uFF0C\u4F7F\u7528\u7A7A\u5E93", e.message);
        this.records = [];
      }
    }
    /**
     * 持久化保存
     */
    _persist() {
      const json = JSON.stringify(this.records);
      try {
        if (typeof GM_setValue === "function") {
          GM_setValue(DB_KEY, json);
        }
      } catch (e) {
        logger.debug("GM_setValue \u5931\u8D25\uFF0C\u964D\u7EA7\u5230 localStorage");
      }
      try {
        localStorage.setItem(DB_KEY, json);
      } catch (e) {
        logger.error("\u6570\u636E\u5E93\u4FDD\u5B58\u5931\u8D25 (localStorage \u53EF\u80FD\u5DF2\u6EE1)", e.message);
      }
    }
    /**
     * 添加一条沟通记录
     * @param {Object} record
     */
    insert(record) {
      this.load();
      const entry = {
        id: record.id,
        name: record.name,
        description: record.description || "",
        greetedAt: Date.now(),
        dryRun: !!record.dryRun,
        greetingSent: record.greetingSent || "",
        ageDesc: record.ageDesc || "",
        gender: record.gender || "",
        workYears: record.workYears || "",
        degree: record.degree || "",
        education: record.education || "",
        lastWork: record.lastWork || "",
        expectLocation: record.expectLocation || "",
        expectPosition: record.expectPosition || "",
        activeTime: record.activeTime || ""
      };
      this.records.push(entry);
      this._persist();
      logger.debug("\u8BB0\u5F55\u5DF2\u4FDD\u5B58: " + record.name + " (\u603B\u8BA1 " + this.records.length + " \u6761)");
    }
    /**
     * 检查是否已存在同 ID 记录
     */
    exists(id) {
      this.load();
      return this.records.some((r) => r.id === id);
    }
    /**
     * 获取总记录数
     */
    count() {
      return this.records.length;
    }
    /**
     * 获取今日记录数
     */
    todayCount() {
      const today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      const cutoff = today.getTime();
      return this.records.filter((r) => r.greetedAt >= cutoff).length;
    }
    /**
     * 获取所有记录
     */
    getAll() {
      this.load();
      return [...this.records];
    }
    /**
     * 导出自定义时间范围的记录为 CSV 文本
     */
    exportCSV(fromDate, toDate) {
      this.load();
      const from = fromDate ? new Date(fromDate).getTime() : 0;
      const to = toDate ? new Date(toDate).getTime() : Infinity;
      let filtered = this.records.filter((r) => r.greetedAt >= from && r.greetedAt <= to);
      const BOM = "\uFEFF";
      const header = "\u5E8F\u53F7,\u59D3\u540D,\u6027\u522B,\u5E74\u9F84,\u7ECF\u9A8C,\u5B66\u5386,\u5B66\u6821/\u4E13\u4E1A,\u6700\u8FD1\u5DE5\u4F5C,\u671F\u671B\u57CE\u5E02,\u671F\u671B\u804C\u4F4D,\u6D3B\u8DC3\u65F6\u95F4,\u7B80\u4ECB,\u6C9F\u901A\u65F6\u95F4,\u62DB\u547C\u8BED\n";
      const rows = filtered.map((r, i) => {
        const time = new Date(r.greetedAt).toLocaleString("zh-CN");
        const desc = (r.description || "").replace(/"/g, '""');
        const greeting = (r.greetingSent || "").replace(/"/g, '""');
        const education = (r.education || "").replace(/"/g, '""');
        const lastWork = (r.lastWork || "").replace(/"/g, '""');
        return `${i + 1},"${r.name}","${r.gender || ""}","${r.ageDesc || ""}","${r.workYears || ""}","${r.degree || ""}","${education}","${lastWork}","${r.expectLocation || ""}","${r.expectPosition || ""}","${r.activeTime || ""}","${desc}","${time}","${greeting}"`;
      }).join("\n");
      return BOM + header + rows;
    }
    /**
     * 导出为 JSON
     */
    exportJSON() {
      this.load();
      return JSON.stringify(this.records, null, 2);
    }
    /**
     * 触发浏览器下载文件
     * @param {string} format - 'csv' | 'json'
     */
    download(format = "csv") {
      const content = format === "json" ? this.exportJSON() : this.exportCSV();
      const ext = format === "json" ? "json" : "csv";
      const mime = format === "json" ? "application/json" : "text/csv;charset=utf-8";
      const filename = `boss-candidates-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.${ext}`;
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      logger.success("\u5DF2\u5BFC\u51FA " + filename + " (" + this.records.length + " \u6761\u8BB0\u5F55)");
    }
    /**
     * 清空所有记录（需确认）
     */
    clear() {
      this.records = [];
      this._persist();
      logger.warn("\u6570\u636E\u5E93\u5DF2\u6E05\u7A7A");
    }
  };
  var candidateDB = new CandidateDatabase();

  // src/api-greet.js
  var API_URL = "/wapi/zpjob/chat/start";
  function getPageListData() {
    try {
      const doc = cardScanner.getTargetDocument();
      if (!doc) return null;
      const cardList = doc.querySelector(".card-list");
      if (!cardList || !cardList.__vue__) return null;
      const inst = cardList.__vue__;
      if (inst.$props && Array.isArray(inst.$props.pageList)) {
        return inst.$props.pageList;
      }
      return null;
    } catch (e) {
      logger.debug("getPageListData error: " + e.message);
      return null;
    }
  }
  function findPageListEntry(card, pageList, cardIndex) {
    if (!pageList || pageList.length === 0) return null;
    for (const entry of pageList) {
      if (entry.geekName === card.name) return entry;
    }
    if (card.encryptGeekId) {
      for (const entry of pageList) {
        if (entry.encryptGeekId === card.encryptGeekId) return entry;
      }
    }
    if (cardIndex >= 0 && cardIndex < pageList.length) {
      const entry = pageList[cardIndex];
      if (card.name === "unknown" || entry.geekName && entry.geekName.slice(0, 1) === card.name.slice(0, 1)) {
        return entry;
      }
    }
    return null;
  }
  function buildApiParams(entry) {
    return {
      gid: entry.encryptGeekId || "",
      expectId: String(entry.expectId || ""),
      jid: entry.encryptJobId || "",
      lid: entry.lid || "",
      securityId: entry.securityId || "",
      suid: entry.suid || ""
    };
  }
  async function sendGreetAPI(card, cardIndex) {
    const pageList = getPageListData();
    if (!pageList) {
      return { success: false, error: "\u65E0\u6CD5\u83B7\u53D6pageList\u6570\u636E" };
    }
    const entry = findPageListEntry(card, pageList, cardIndex);
    if (!entry) {
      return { success: false, error: "\u65E0\u6CD5\u5339\u914D\u5019\u9009\u4EBA\u6570\u636E" };
    }
    const params = buildApiParams(entry);
    if (!params.gid) {
      return { success: false, error: "\u7F3A\u5C11\u5FC5\u8981\u53C2\u6570: gid" };
    }
    if (!params.jid) {
      return { success: false, error: "\u7F3A\u5C11\u5FC5\u8981\u53C2\u6570: jid" };
    }
    if (!params.securityId) {
      logger.warn("\u7F3A\u5C11 securityId\uFF0C\u53EF\u80FD\u5931\u8D25");
    }
    logger.debug("API\u53C2\u6570: gid=" + params.gid.slice(0, 15) + "... expectId=" + params.expectId + " jid=" + params.jid.slice(0, 15) + "...");
    const formBody = new URLSearchParams();
    formBody.append("gid", params.gid);
    formBody.append("suid", params.suid);
    formBody.append("jid", params.jid);
    formBody.append("expectId", params.expectId);
    formBody.append("lid", params.lid);
    formBody.append("greet", stateManager.getGreetingTemplate() || "");
    formBody.append("from", "");
    formBody.append("securityId", params.securityId);
    formBody.append("customGreetingGuide", "-1");
    const targetWin = cardScanner.getTargetWindow();
    if (!targetWin || !targetWin.fetch) {
      return { success: false, error: "\u65E0\u6CD5\u8BBF\u95EEiframe fetch API" };
    }
    try {
      const resp = await targetWin.fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        credentials: "include"
      });
      const data = await resp.json();
      if (data.code === 0) {
        logger.success("API\u6253\u62DB\u547C\u6210\u529F: " + card.name + " (geekId:" + (data.zpData?.geekId || "?") + ")");
        return { success: true, data: data.zpData, entry };
      } else {
        const errMsg = data.message || "code=" + data.code;
        logger.error("API\u6253\u62DB\u547C\u5931\u8D25: " + errMsg + " raw=" + JSON.stringify(data).slice(0, 300));
        return { success: false, error: errMsg };
      }
    } catch (e) {
      logger.error("API\u6253\u62DB\u547C\u5F02\u5E38: " + e.message);
      return { success: false, error: e.message };
    }
  }
  function extractProfile(entry) {
    if (!entry) return {};
    let education = "";
    if (entry.showEdus && entry.showEdus.length > 0) {
      const edu = entry.showEdus[0];
      education = [edu.school, edu.major, edu.degreeName].filter(Boolean).join(" / ");
    }
    let lastWork = "";
    if (entry.geekLastWork) {
      lastWork = [entry.geekLastWork.company, entry.geekLastWork.positionName].filter(Boolean).join(" \xB7 ");
    }
    return {
      ageDesc: entry.ageDesc || "",
      gender: entry.geekGender === 1 ? "\u7537" : entry.geekGender === 2 ? "\u5973" : "",
      workYears: entry.geekWorkYear || "",
      degree: entry.geekDegree || "",
      education,
      lastWork,
      expectLocation: entry.expectLocationName || "",
      expectPosition: entry.expectPositionName || "",
      activeTime: entry.activeTimeDesc || ""
    };
  }

  // src/intention-learner.js
  var PROFILE_KEY = "boss_filter_profile";
  function extractKeywords(texts, stopWords) {
    const wordFreq = {};
    const stops = new Set(stopWords || [
      "\u7684",
      "\u4E86",
      "\u5728",
      "\u662F",
      "\u548C",
      "\u4E0E",
      "\u53CA",
      "\u6216",
      "\u7B49",
      "\u5177\u5907",
      "\u62E5\u6709",
      "\u5177\u6709",
      "\u80FD\u529B",
      "\u65B9\u9762",
      "\u76F8\u5173",
      "\u4EE5\u4E0A",
      "\u4EE5\u4E0B",
      "\u53EF\u4EE5",
      "\u80FD\u591F",
      "\u8F83\u5F3A",
      "\u826F\u597D",
      "\u4F18\u79C0",
      "\u4E00\u5B9A",
      "\u719F\u6089",
      "\u4E86\u89E3",
      "\u638C\u63E1",
      "\u80CC\u666F",
      "\u7ECF\u9A8C",
      "\u5DE5\u4F5C",
      "\u8D1F\u8D23",
      "\u53C2\u4E0E",
      "\u4ECE\u4E8B",
      "\u8FDB\u884C",
      "\u5B8C\u6210",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0"
    ]);
    for (const text of texts) {
      if (!text) continue;
      const words = text.match(/[一-龥]{2,6}|[a-zA-Z]{3,}/g) || [];
      for (const w of words) {
        const lower = w.toLowerCase();
        if (stops.has(lower) || stops.has(w) || w.length < 2) continue;
        wordFreq[lower] = (wordFreq[lower] || 0) + 1;
      }
    }
    return Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).map(([word, count]) => ({ word, count }));
  }
  function buildProfile(cards) {
    if (!cards || cards.length === 0) return null;
    const texts = [];
    const degrees = [];
    const workYears = [];
    const cities = [];
    let has985211 = false, hasOverseas = false;
    for (const card of cards) {
      const d = card._pageData || {};
      if (card.title) texts.push(card.title);
      if (card.description) texts.push(card.description);
      if (d.geekDesc) texts.push(typeof d.geekDesc === "string" ? d.geekDesc : d.geekDesc.content);
      if (d.geekLastWork?.responsibility) texts.push(d.geekLastWork.responsibility);
      if (d.geekDegree) degrees.push(d.geekDegree);
      if (d.eduLevelShow) degrees.push(d.eduLevelShow);
      if (d.geekWorkYear) {
        const y = parseInt(d.geekWorkYear);
        if (y > 0) workYears.push(y);
      }
      if (d.expectLocation) cities.push(d.expectLocation);
      if (d.cityName) cities.push(d.cityName);
      const eduList = d.showEdus || d.geekEdus || [];
      for (const edu of eduList) {
        const name = edu.school || edu.expName || "";
        if (/985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(name)) has985211 = true;
        if (/[a-zA-Z].*(University|College|Institute)/i.test(name) && !/中国|师范|理工|工业|科技|外语/i.test(name)) hasOverseas = true;
      }
    }
    const keywords = extractKeywords(texts, []);
    const skillKeywords = keywords.filter((k) => k.count >= 2 && k.word.length >= 2).slice(0, 25);
    const degreeDist = {};
    for (const deg of degrees) {
      const d = deg.includes("\u7855\u58EB") ? "\u7855\u58EB" : deg.includes("\u535A\u58EB") ? "\u535A\u58EB" : deg.includes("\u672C\u79D1") ? "\u672C\u79D1" : deg.includes("\u5927\u4E13") ? "\u5927\u4E13" : deg;
      degreeDist[d] = (degreeDist[d] || 0) + 1;
    }
    const degreeSorted = Object.entries(degreeDist).sort((a, b) => b[1] - a[1]);
    const yrMin = workYears.length > 0 ? Math.min(...workYears) : 1;
    const yrMax = workYears.length > 0 ? Math.max(...workYears) : 10;
    const yrAvg = workYears.length > 0 ? Math.round(workYears.reduce((a, b) => a + b, 0) / workYears.length) : 3;
    const cityDist = {};
    for (const c of cities) {
      if (c && c.length > 1) cityDist[c] = (cityDist[c] || 0) + 1;
    }
    const topCities = Object.entries(cityDist).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let schoolTier = 0;
    if (has985211 && hasOverseas) schoolTier = 3;
    else if (has985211) schoolTier = 2;
    else if (hasOverseas) schoolTier = 3;
    else schoolTier = 1;
    const profile = {
      createdAt: Date.now(),
      source: "boss_recommend",
      candidateCount: cards.length,
      skillKeywords: skillKeywords.map((k) => k.word),
      degreeRequired: degreeSorted[0]?.[0] || "\u672C\u79D1",
      degreeDistribution: degreeSorted,
      workYearsMin: yrMin,
      workYearsMax: yrMax,
      workYearsAvg: yrAvg,
      schoolTier,
      prefer985211: has985211,
      preferOverseas: hasOverseas,
      targetCities: topCities.map(([c]) => c),
      salaryMin: 0,
      salaryMax: 5e4,
      industryKeywords: [],
      sampleCandidates: cards.slice(0, 3).map((c) => ({
        name: c.name,
        age: c.ageDesc || "",
        degree: c.degree || "",
        workYears: c.workYears || "",
        school: c.education || ""
      }))
    };
    return profile;
  }
  function saveProfile(profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function getProfileSummary(profile) {
    if (!profile) return null;
    return {
      candidateCount: profile.candidateCount,
      topSkills: profile.skillKeywords?.slice(0, 8).join("\u3001"),
      degree: profile.degreeRequired,
      workYears: `${profile.workYearsMin}-${profile.workYearsMax}\u5E74`,
      cities: profile.targetCities?.slice(0, 3).join("\u3001"),
      createdAt: new Date(profile.createdAt).toLocaleString("zh-CN")
    };
  }

  // src/candidate-scorer.js
  var DEFAULT_WEIGHTS = {
    skills: 30,
    degree: 10,
    school: 10,
    workYears: 10,
    location: 10,
    position: 15,
    company: 10,
    salary: 5
  };
  var _weights = { ...DEFAULT_WEIGHTS };
  var _minScore = 40;
  function setMinScore(s) {
    _minScore = s;
  }
  function getMinScore() {
    return _minScore;
  }
  function scoreSkills(card, profile) {
    if (!profile.skillKeywords || profile.skillKeywords.length === 0) return _weights.skills;
    const text = [
      card.title || "",
      card.description || "",
      card.education || "",
      card.lastWork || "",
      card._pageData?.geekDesc?.content || card._pageData?.geekDesc || ""
    ].join(" ").toLowerCase();
    let matched = 0;
    const keywords = profile.skillKeywords.slice(0, 15);
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) matched++;
    }
    if (keywords.length === 0) return Math.round(_weights.skills * 0.5);
    return Math.round(_weights.skills * (matched / keywords.length));
  }
  function scoreDegree(card, profile) {
    const degreeOrder = ["\u9AD8\u4E2D", "\u5927\u4E13", "\u672C\u79D1", "\u7855\u58EB", "\u535A\u58EB", "MBA", "EMBA"];
    const cardDegree = card.degree || "";
    const requiredDegree = profile.degreeRequired || "\u672C\u79D1";
    const cardIdx = degreeOrder.findIndex((d) => cardDegree.includes(d));
    const reqIdx = degreeOrder.findIndex((d) => requiredDegree.includes(d));
    if (cardIdx === -1 || reqIdx === -1) return Math.round(_weights.degree * 0.5);
    if (cardIdx >= reqIdx) return _weights.degree;
    if (cardIdx === reqIdx - 1) return Math.round(_weights.degree * 0.7);
    return Math.round(_weights.degree * 0.3);
  }
  function scoreSchool(card, profile) {
    const eduText = (card.education || "").toLowerCase();
    let score = 0;
    if (profile.prefer985211 && /985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(eduText)) {
      score += _weights.school * 0.6;
    }
    if (profile.preferOverseas && /[a-z].*(university|college|institute|school)/i.test(eduText) && !/中国|师范|理工|工业|科技|农业|林业|海洋|民族|政法|财经|外国语|中医药/i.test(eduText)) {
      score += _weights.school * 0.6;
    }
    if (score === 0 && /本科|学士|大学|学院/.test(eduText)) {
      score = Math.round(_weights.school * 0.3);
    }
    return Math.min(_weights.school, score);
  }
  function scoreWorkYears(card, profile) {
    const cardYears = parseInt(card.workYears) || 0;
    const minYears = profile.workYearsMin || 1;
    const maxYears = profile.workYearsMax || 10;
    const avgYears = profile.workYearsAvg || 3;
    if (cardYears === 0) return Math.round(_weights.workYears * 0.5);
    if (cardYears >= minYears && cardYears <= maxYears) return _weights.workYears;
    const dist = Math.abs(cardYears - avgYears);
    if (dist <= 2) return Math.round(_weights.workYears * 0.8);
    if (dist <= 5) return Math.round(_weights.workYears * 0.5);
    return Math.round(_weights.workYears * 0.2);
  }
  function scoreLocation(card, profile) {
    if (!profile.targetCities || profile.targetCities.length === 0) return Math.round(_weights.location * 0.5);
    const cardCities = [card.expectLocation || "", card.cityName || ""].map((c) => c.toLowerCase());
    const targets = profile.targetCities.map((c) => c.toLowerCase());
    for (const tc of targets) {
      for (const cc of cardCities) {
        if (cc && tc && (cc.includes(tc) || tc.includes(cc))) return _weights.location;
      }
    }
    return 0;
  }
  function scorePosition(card, profile) {
    const text = [card.expectPosition || "", card.title || "", card.lastWork || ""].join(" ").toLowerCase();
    const keywords = profile.skillKeywords?.slice(0, 10) || [];
    let matched = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) matched++;
    }
    if (keywords.length === 0) return Math.round(_weights.position * 0.5);
    return Math.round(_weights.position * (matched / Math.min(5, keywords.length)));
  }
  function scoreCompany(card, profile) {
    const companyText = (card.lastWork || "").toLowerCase();
    let score = 0;
    const bigNames = [
      "\u817E\u8BAF",
      "\u963F\u91CC",
      "\u767E\u5EA6",
      "\u5B57\u8282",
      "\u7F8E\u56E2",
      "\u4EAC\u4E1C",
      "\u7F51\u6613",
      "\u534E\u4E3A",
      "\u5C0F\u7C73",
      "\u5FB7\u52E4",
      "\u666E\u534E\u6C38\u9053",
      "\u5B89\u6C38",
      "\u6BD5\u9A6C\u5A01",
      "\u9EA6\u80AF\u9521",
      "\u6CE2\u58EB\u987F",
      "\u8D1D\u6069",
      "\u5FAE\u8F6F",
      "\u8C37\u6B4C",
      "\u4E9A\u9A6C\u900A",
      "\u82F9\u679C",
      "IBM",
      "\u7532\u9AA8\u6587",
      "\u4E2D\u91D1",
      "\u4E2D\u4FE1",
      "\u534E\u6CF0",
      "\u56DB\u5927",
      "500\u5F3A",
      "\u4E0A\u5E02",
      "\u5916\u4F01",
      "\u592E\u4F01",
      "\u56FD\u4F01"
    ];
    for (const name of bigNames) {
      if (companyText.includes(name.toLowerCase())) {
        score += _weights.company * 0.3;
        break;
      }
    }
    return Math.min(_weights.company, score + Math.round(_weights.company * 0.1));
  }
  function scoreSalary(card, profile) {
    return Math.round(_weights.salary * 0.5);
  }
  function scoreCandidate(card, profile) {
    if (!profile) return { total: 100, details: {}, passed: true, reason: "\u65E0\u753B\u50CF" };
    const scores = {
      skills: scoreSkills(card, profile),
      degree: scoreDegree(card, profile),
      school: scoreSchool(card, profile),
      workYears: scoreWorkYears(card, profile),
      location: scoreLocation(card, profile),
      position: scorePosition(card, profile),
      company: scoreCompany(card, profile),
      salary: scoreSalary(card, profile)
    };
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const maxPossible = Object.values(_weights).reduce((a, b) => a + b, 0);
    const normalizedTotal = Math.round(total / maxPossible * 100);
    const passed = normalizedTotal >= _minScore;
    return {
      total: normalizedTotal,
      maxPossible: 100,
      details: scores,
      passed,
      reason: passed ? `\u8FBE\u6807 (${normalizedTotal}\u5206)` : `\u672A\u8FBE\u6807 (${normalizedTotal}\u5206 < ${_minScore}\u5206)`
    };
  }
  function filterCandidates(cards, profile, minScore) {
    if (minScore !== void 0) setMinScore(minScore);
    const passed = [], rejected = [];
    for (const card of cards) {
      const result = scoreCandidate(card, profile);
      card._score = result;
      (result.passed ? passed : rejected).push(card);
    }
    return { passed, rejected };
  }

  // src/action-engine.js
  var ActionEngine = class {
    constructor() {
      this._eventBus = null;
      this._running = false;
      this._retryCount = 0;
    }
    /**
     * 绑定事件总线
     */
    setEventBus(bus) {
      this._eventBus = bus;
    }
    /**
     * 开始自动化循环
     */
    async start() {
      if (this._running) return;
      this._running = true;
      stateManager.startSession();
      this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
      logger.info(stateManager.isDryRun() ? "\u{1F7E1} Dry-run \u6A21\u5F0F\u542F\u52A8\uFF08\u4E0D\u4F1A\u771F\u5B9E\u53D1\u9001\u6D88\u606F\uFF09" : "\u{1F7E2} \u81EA\u52A8\u5316\u5DF2\u542F\u52A8");
      try {
        await this._mainLoop();
      } catch (e) {
        logger.error("\u81EA\u52A8\u5316\u4E3B\u5FAA\u73AF\u5F02\u5E38", e.message);
      } finally {
        this._running = false;
      }
    }
    /**
     * 暂停
     */
    pause() {
      this._running = false;
      stateManager.setRunState(RUN_STATES.PAUSED);
      this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.PAUSED);
      logger.warn("\u81EA\u52A8\u5316\u5DF2\u6682\u505C");
    }
    /**
     * 恢复
     */
    async resume() {
      if (this._running) return;
      this._running = true;
      stateManager.setRunState(RUN_STATES.RUNNING);
      this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
      logger.info("\u81EA\u52A8\u5316\u5DF2\u6062\u590D");
      try {
        await this._mainLoop();
      } catch (e) {
        logger.error("\u81EA\u52A8\u5316\u4E3B\u5FAA\u73AF\u5F02\u5E38", e.message);
      } finally {
        this._running = false;
      }
    }
    /**
     * 停止
     */
    stop() {
      this._running = false;
      stateManager.setRunState(RUN_STATES.STOPPED);
      this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.STOPPED);
      logger.info("\u81EA\u52A8\u5316\u5DF2\u505C\u6B62");
    }
    /**
     * 主循环：收集本页所有按钮 → 逐个处理 → 页面刷新后重新收集
     */
    async _mainLoop() {
      let cardQueue = [];
      while (this._running && stateManager.getRunState() === RUN_STATES.RUNNING) {
        if (stateManager.hasReachedLimit()) {
          logger.success("reach limit, stopping");
          this._eventBus?.emit(EVENTS.LIMIT_REACHED);
          this.stop();
          break;
        }
        if (stateManager.getFailureCount() >= MAX_CONSECUTIVE_FAILURES) {
          logger.error("too many failures, stopping");
          this.stop();
          break;
        }
        if (cardQueue.length === 0) {
          const cards = cardScanner.scanCards();
          if (cards.length === 0) {
            logger.warn("no cards found, retry in 3s");
            await new Promise((r) => setTimeout(r, 3e3));
            continue;
          }
          cardQueue = cards.filter((c) => !stateManager.isProcessed(c.id));
          if (cardQueue.length === 0) {
            logger.info("all cards processed, scroll for more");
            const tgtWin = cardScanner.getTargetWindow();
            const tgtDoc = cardScanner.getTargetDocument() || document;
            tgtWin.scrollTo({ top: tgtDoc.body.scrollHeight, behavior: "smooth" });
            await new Promise((r) => setTimeout(r, 2e3));
            const newCards = await cardScanner.waitForNewCards(3e3);
            if (newCards.length === 0) {
              logger.info("no more cards");
              break;
            }
            cardQueue = newCards.filter((c) => !stateManager.isProcessed(c.id));
            if (cardQueue.length === 0) continue;
          }
          const profile = loadProfile();
          if (profile) {
            const { passed, rejected } = filterCandidates(cardQueue, profile);
            logger.info("\u7B5B\u9009\u7ED3\u679C: \u8FBE\u6807 " + passed.length + " / \u6DD8\u6C70 " + rejected.length + " (\u5206\u6570\u7EBF: " + getMinScore() + "\u5206)");
            if (rejected.length > 0) {
              logger.debug("\u6DD8\u6C70: " + rejected.map((c) => c.name + "(" + (c._score?.total || 0) + "\u5206)").join(", "));
            }
            cardQueue = passed;
            if (cardQueue.length === 0) {
              logger.info("\u672C\u9875\u65E0\u8FBE\u6807\u5019\u9009\u4EBA\uFF0C\u52A0\u8F7D\u66F4\u591A");
              const tgtWin = cardScanner.getTargetWindow();
              const tgtDoc = cardScanner.getTargetDocument() || document;
              tgtWin.scrollTo({ top: tgtDoc.body.scrollHeight, behavior: "smooth" });
              await new Promise((r) => setTimeout(r, 2e3));
              continue;
            }
          } else {
            logger.info("\u65E0\u7B5B\u9009\u753B\u50CF\uFF0C\u4E0D\u8FC7\u6EE4");
          }
          logger.info("collected " + cardQueue.length + " candidates, processing...");
        }
        const card = cardQueue.shift();
        const targetDoc = cardScanner.getTargetDocument();
        const btnValid = card.greetButton && targetDoc && targetDoc.contains(card.greetButton);
        if (!btnValid) {
          logger.debug("card removed from DOM: " + card.name + ", skipping");
          continue;
        }
        logger.info("greeting: " + card.name);
        const result = await this.greetCandidate(card);
        if (result.success) {
          stateManager.markProcessed(card.id);
          stateManager.incrementGreeted();
          stateManager.resetFailure();
          this._retryCount = 0;
          const profile = result.profile || {};
          candidateDB.insert({
            id: card.id,
            name: card.name,
            description: card.title,
            dryRun: stateManager.isDryRun(),
            ageDesc: profile.ageDesc,
            gender: profile.gender,
            workYears: profile.workYears,
            degree: profile.degree,
            education: profile.education,
            lastWork: profile.lastWork,
            expectLocation: profile.expectLocation,
            expectPosition: profile.expectPosition,
            activeTime: profile.activeTime
          });
          this._eventBus?.emit(EVENTS.CARD_PROCESSED);
          this._eventBus?.emit(EVENTS.DB_UPDATED);
          logger.success("ok: " + card.name + " (" + stateManager.getTotalGreeted() + "/" + stateManager.getMaxPerSession() + ")");
        } else {
          stateManager.incrementFailure();
          this._retryCount++;
          logger.error("fail: " + card.name + " - " + (result.error || result.message));
          if (this._retryCount > 0) {
            await exponentialBackoff(this._retryCount - 1);
          }
        }
        await randomIdleAction();
        if (this._running && stateManager.getRunState() === RUN_STATES.RUNNING) {
          const min = stateManager.getMinDelay();
          const max = stateManager.getMaxDelay();
          await humanDelay(min, max, (min + max) / 2, (max - min) / 4);
        }
      }
      logger.info("auto loop ended");
    }
    /**
     * 向候选人发起沟通
     * 策略: Tier 0 API直调用 → Tier 1-3 DOM点击
     * @param {import('./card-scanner.js').CardInfo} card
     * @returns {Promise<GreetResult>}
     */
    async greetCandidate(card) {
      const TIMEOUT = 3e4;
      const doGreet = async () => {
        if (stateManager.isDryRun()) {
          logger.info(`[DRY-RUN] \u6A21\u62DF\u6C9F\u901A: ${card.name}`, {
            name: card.name,
            title: card.title,
            company: card.company,
            hasButton: !!card.greetButton,
            hasVueInstance: !!card.vueInstance
          });
          await humanDelay(1e3, 2e3, 1500, 200);
          return { success: true, message: "Dry-run \u6A21\u62DF\u6210\u529F", method: "dry-run" };
        }
        const cardIndex = cardScanner.currentCards.indexOf(card);
        if (cardIndex >= 0) {
          logger.debug("Tier 0: \u5C1D\u8BD5API\u76F4\u63A5\u6253\u62DB\u547C...");
          const apiResult = await sendGreetAPI(card, cardIndex);
          if (apiResult.success) {
            return { success: true, message: "API\u6253\u62DB\u547C\u6210\u529F", method: "api-direct", profile: extractProfile(apiResult.entry) };
          }
          logger.debug("API\u6253\u62DB\u547C\u5931\u8D25\uFF0C\u964D\u7EA7\u5230DOM\u70B9\u51FB: " + (apiResult.error || "unknown"));
        }
        await humanScrollToElement(card.element, cardScanner.getTargetWindow());
        await humanDelay(800, 1500, 1e3, 200);
        const clickResult = await this._threeTierClick(card);
        if (!clickResult.success) return clickResult;
        await humanDelay(800, 2e3, 1200, 300);
        const dialogResult = await this._handleGreetDialog();
        if (!dialogResult.success) return dialogResult;
        await humanDelay(1e3, 3e3, 2e3, 500);
        return { success: true, message: "\u6C9F\u901A\u6210\u529F", method: clickResult.method };
      };
      const result = await Promise.race([
        doGreet(),
        new Promise(
          (resolve) => setTimeout(() => resolve({ success: false, message: "\u64CD\u4F5C\u8D85\u65F6", error: "timeout" }), TIMEOUT)
        )
      ]);
      return result;
    }
    /**
     * 三层点击策略
     */
    async _threeTierClick(card) {
      const vueResult = await this._tryVueClick(card);
      if (vueResult.success) {
        return { ...vueResult, method: "vue-component" };
      }
      logger.debug("Vue\u7EC4\u4EF6\u64CD\u4F5C\u5931\u8D25\uFF0C\u5C1D\u8BD5\u4E8B\u4EF6\u6D3E\u53D1...");
      if (card.greetButton) {
        try {
          await dispatchHumanClick(card.greetButton);
          logger.debug("Tier 2: \u4E8B\u4EF6\u94FE\u6D3E\u53D1\u5B8C\u6210");
          await humanDelay(500, 1e3, 700, 150);
          const dialog = this._findDialog();
          if (dialog) {
            return { success: true, message: "\u4E8B\u4EF6\u6D3E\u53D1\u6210\u529F", method: "event-chain" };
          }
          const newCards = cardScanner.scanCards();
          const updatedCard = newCards.find((c) => c.id === card.id);
          if (updatedCard && updatedCard.alreadyGreeted) {
            return { success: true, message: "\u5DF2\u6807\u8BB0\u4E3A\u5DF2\u6C9F\u901A", method: "event-chain" };
          }
        } catch (e) {
          logger.debug("Tier 2 \u5931\u8D25:", e.message);
        }
      }
      if (card.greetButton) {
        try {
          card.greetButton.click();
          logger.debug("Tier 3: \u76F4\u63A5 click()");
          await humanDelay(500, 1e3, 700, 150);
          const dialog = this._findDialog();
          if (dialog) {
            return { success: true, message: "\u76F4\u63A5\u70B9\u51FB\u6210\u529F", method: "direct-click" };
          }
        } catch (e) {
          logger.debug("Tier 3 \u5931\u8D25:", e.message);
        }
      }
      return { success: false, message: "\u6240\u6709\u70B9\u51FB\u7B56\u7565\u5747\u5931\u8D25", error: "no-valid-click-method" };
    }
    /**
     * 尝试通过Vue组件实例触发沟通
     */
    async _tryVueClick(card) {
      const vueInst = card.vueInstance;
      if (!vueInst) return { success: false, message: "\u672A\u627E\u5230Vue\u5B9E\u4F8B" };
      try {
        if (vueInst.handleGreet) {
          vueInst.handleGreet();
          return { success: true, message: "\u8C03\u7528 handleGreet()" };
        }
        const methodNames = [
          "greet",
          "onGreet",
          "handleGreet",
          "startChat",
          "onStartChat",
          "sendGreeting",
          "handleClickGreet",
          "openDialog",
          "showGreet",
          "chat"
        ];
        for (const method of methodNames) {
          if (typeof vueInst[method] === "function") {
            logger.debug(`Vue\u5B9E\u4F8B\u65B9\u6CD5\u8C03\u7528: ${method}()`);
            vueInst[method]();
            return { success: true, message: `\u8C03\u7528 ${method}()` };
          }
        }
        if (vueInst.setupState) {
          for (const method of methodNames) {
            if (typeof vueInst.setupState[method] === "function") {
              vueInst.setupState[method]();
              return { success: true, message: `\u8C03\u7528 setupState.${method}()` };
            }
          }
        }
        if (vueInst.proxy) {
          for (const method of methodNames) {
            if (typeof vueInst.proxy[method] === "function") {
              vueInst.proxy[method]();
              return { success: true, message: `\u8C03\u7528 proxy.${method}()` };
            }
          }
        }
        const stateKeys = ["showGreet", "greetVisible", "dialogVisible", "chatVisible", "showDialog", "visible"];
        for (const key of stateKeys) {
          if (key in vueInst) {
            vueInst[key] = true;
            return { success: true, message: `\u8BBE\u7F6E ${key}=true` };
          }
          if (vueInst.setupState && key in vueInst.setupState) {
            vueInst.setupState[key] = true;
            return { success: true, message: `\u8BBE\u7F6E setupState.${key}=true` };
          }
          if (vueInst.proxy && key in vueInst.proxy) {
            vueInst.proxy[key] = true;
            return { success: true, message: `\u8BBE\u7F6E proxy.${key}=true` };
          }
        }
        return { success: false, message: "Vue\u5B9E\u4F8B\u4E2D\u672A\u627E\u5230\u53EF\u7528\u65B9\u6CD5\u6216\u72B6\u6001", error: "no-vue-method" };
      } catch (e) {
        return { success: false, message: "Vue\u5B9E\u4F8B\u64CD\u4F5C\u5F02\u5E38", error: e.message };
      }
    }
    /**
     * 查找招呼语弹窗
     */
    _findDialog() {
      for (const selector of GREET_DIALOG_SELECTORS) {
        try {
          const el = (cardScanner.getTargetDocument() || document).querySelector(selector);
          if (el && el.offsetHeight > 0) return el;
        } catch (e) {
        }
      }
      return null;
    }
    /**
     * 处理招呼语弹窗
     */
    async _handleGreetDialog() {
      let dialog = null;
      for (const selector of GREET_DIALOG_SELECTORS) {
        dialog = await waitForElement(selector, 3e3, cardScanner.getTargetDocument() || document);
        if (dialog) break;
      }
      if (!dialog) {
        logger.debug("\u672A\u68C0\u6D4B\u5230\u62DB\u547C\u8BED\u5F39\u7A97\uFF0C\u53EF\u80FD\u76F4\u63A5\u53D1\u9001\u6210\u529F");
        return { success: true, message: "\u65E0\u5F39\u7A97\uFF08\u76F4\u63A5\u53D1\u9001\uFF09" };
      }
      logger.debug("\u68C0\u6D4B\u5230\u62DB\u547C\u8BED\u5F39\u7A97");
      const template = stateManager.getGreetingTemplate();
      if (template) {
        const inputSelectors = ["textarea", 'input[type="text"]', '[contenteditable="true"]', '[class*="input"]'];
        for (const sel of inputSelectors) {
          try {
            const input = dialog.querySelector(sel);
            if (input) {
              input.value = template;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
              logger.debug("\u5DF2\u586B\u5165\u81EA\u5B9A\u4E49\u62DB\u547C\u8BED");
              break;
            }
          } catch (e) {
          }
        }
      }
      await humanDelay(300, 800, 500, 150);
      let sendButton = null;
      for (const selector of GREET_SEND_SELECTORS) {
        try {
          sendButton = dialog.querySelector(selector);
          if (sendButton && !sendButton.disabled) break;
        } catch (e) {
        }
      }
      if (!sendButton) {
        for (const selector of GREET_SEND_SELECTORS) {
          try {
            sendButton = (cardScanner.getTargetDocument() || document).querySelector(selector);
            if (sendButton && !sendButton.disabled) break;
          } catch (e) {
          }
        }
      }
      if (!sendButton) {
        logger.warn("\u672A\u627E\u5230\u53D1\u9001\u6309\u94AE\uFF0C\u5C1D\u8BD5\u5173\u95ED\u5F39\u7A97");
        const closeBtn = dialog.querySelector('[class*="close"], [class*="cancel"], .icon-close');
        if (closeBtn) closeBtn.click();
        return { success: false, message: "\u672A\u627E\u5230\u53D1\u9001\u6309\u94AE", error: "no-send-button" };
      }
      await dispatchHumanClick(sendButton);
      logger.debug("\u5DF2\u70B9\u51FB\u53D1\u9001\u6309\u94AE");
      const removed = await waitForElementRemoval(
        GREET_DIALOG_SELECTORS[0],
        5e3,
        cardScanner.getTargetDocument() || document
      );
      if (!removed) {
        logger.warn("\u5F39\u7A97\u53EF\u80FD\u672A\u5173\u95ED");
      }
      return { success: true, message: "\u62DB\u547C\u8BED\u5DF2\u53D1\u9001" };
    }
  };
  var actionEngine = new ActionEngine();

  // src/ui-panel.js
  var UIPanel = class {
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
      if (document.getElementById("boss-auto-panel")) return;
      this.container = this._buildPanel();
      document.body.insertAdjacentElement("beforeend", this.container);
      logger.info("\u63A7\u5236\u9762\u677F\u5DF2\u52A0\u8F7D");
      this.updateProgress();
      this.updateStatus(RUN_STATES.IDLE);
      this._subscribeEvents();
    }
    /**
     * 构建面板DOM
     */
    _buildPanel() {
      const panel = document.createElement("div");
      panel.id = "boss-auto-panel";
      Object.assign(panel.style, {
        position: "fixed",
        top: "80px",
        right: "20px",
        width: this.panelWidth + "px",
        maxHeight: "none",
        height: this.panelHeight + "px",
        minWidth: "280px",
        minHeight: "300px",
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1)",
        zIndex: "99999",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: "13px",
        color: "#333",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        border: "1px solid #e8e8e8",
        userSelect: "none",
        transition: "opacity 0.2s"
      });
      const header = document.createElement("div");
      Object.assign(header.style, {
        padding: "12px 16px",
        background: "linear-gradient(135deg, #1677ff, #0958d9)",
        color: "#fff",
        fontWeight: "600",
        fontSize: "14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        cursor: "move"
      });
      header.innerHTML = `
      <span>\u{1F916} BOSS \u81EA\u52A8\u6C9F\u901A</span>
      <span>
        <button id="boss-auto-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">\u2212</button>
        <button id="boss-auto-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">\xD7</button>
      </span>
    `;
      header.addEventListener("mousedown", this._onDragStart.bind(this));
      document.addEventListener("mousemove", this._onDragMove.bind(this));
      document.addEventListener("mouseup", this._onDragEnd.bind(this));
      const body = document.createElement("div");
      body.id = "boss-auto-body";
      Object.assign(body.style, {
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflowY: "auto"
      });
      this.statusText = document.createElement("div");
      Object.assign(this.statusText.style, {
        textAlign: "center",
        padding: "6px 12px",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: "500",
        background: "#f0f0f0"
      });
      this.statusText.textContent = "\u5C31\u7EEA";
      const progressSection = document.createElement("div");
      progressSection.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;"><span>\u6C9F\u901A\u8FDB\u5EA6</span><span id="boss-auto-progress-text">0 / 0</span></div>';
      const progressBg = document.createElement("div");
      Object.assign(progressBg.style, {
        width: "100%",
        height: "6px",
        background: "#f0f0f0",
        borderRadius: "3px",
        overflow: "hidden"
      });
      this.progressBar = document.createElement("div");
      Object.assign(this.progressBar.style, {
        width: "0%",
        height: "100%",
        background: "linear-gradient(90deg, #1677ff, #69b1ff)",
        borderRadius: "3px",
        transition: "width 0.3s"
      });
      progressBg.appendChild(this.progressBar);
      progressSection.appendChild(progressBg);
      const buttonGroup = document.createElement("div");
      Object.assign(buttonGroup.style, {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px"
      });
      const btnStart = this._createButton("\u25B6 \u5F00\u59CB", "#1677ff", () => this._eventBus?.emit(EVENTS.START));
      const btnPause = this._createButton("\u23F8 \u6682\u505C", "#fa8c16", () => this._eventBus?.emit(EVENTS.PAUSE));
      const btnResume = this._createButton("\u25B6 \u7EE7\u7EED", "#52c41a", () => this._eventBus?.emit(EVENTS.RESUME));
      const btnStop = this._createButton("\u23F9 \u505C\u6B62", "#ff4d4f", () => this._eventBus?.emit(EVENTS.STOP));
      buttonGroup.appendChild(btnStart);
      buttonGroup.appendChild(btnPause);
      buttonGroup.appendChild(btnResume);
      buttonGroup.appendChild(btnStop);
      const toggleRow = document.createElement("div");
      Object.assign(toggleRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderTop: "1px solid #f0f0f0",
        borderBottom: "1px solid #f0f0f0"
      });
      const toggleLabel = document.createElement("span");
      toggleLabel.textContent = "\u{1F530} Dry-run (\u6F14\u7EC3\u6A21\u5F0F)";
      toggleLabel.style.fontSize = "12px";
      const toggleSwitch = document.createElement("input");
      toggleSwitch.type = "checkbox";
      toggleSwitch.checked = stateManager.isDryRun();
      toggleSwitch.addEventListener("change", () => {
        stateManager.setDryRun(toggleSwitch.checked);
        this.updateStatus();
      });
      Object.assign(toggleSwitch.style, { cursor: "pointer" });
      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggleSwitch);
      const dbRow = document.createElement("div");
      Object.assign(dbRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderTop: "1px solid #f0f0f0",
        fontSize: "12px"
      });
      const dbStats = document.createElement("span");
      dbStats.id = "boss-auto-db-stats";
      dbStats.textContent = "\u{1F4CA} \u8BB0\u5F55: \u52A0\u8F7D\u4E2D...";
      dbRow.appendChild(dbStats);
      const exportBtns = document.createElement("span");
      const csvBtn = document.createElement("button");
      csvBtn.textContent = "CSV";
      Object.assign(csvBtn.style, {
        background: "#1677ff",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        padding: "2px 8px",
        cursor: "pointer",
        fontSize: "11px",
        marginLeft: "4px"
      });
      csvBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        candidateDB.download("csv");
      });
      const jsonBtn = document.createElement("button");
      jsonBtn.textContent = "JSON";
      Object.assign(jsonBtn.style, {
        background: "#52c41a",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        padding: "2px 8px",
        cursor: "pointer",
        fontSize: "11px",
        marginLeft: "4px"
      });
      jsonBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        candidateDB.download("json");
      });
      exportBtns.appendChild(csvBtn);
      exportBtns.appendChild(jsonBtn);
      dbRow.appendChild(exportBtns);
      const speedRow = document.createElement("div");
      speedRow.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span>\u64CD\u4F5C\u95F4\u9694</span>
        <span id="boss-auto-delay-label">${stateManager.getMinDelay() / 1e3}\u2013${stateManager.getMaxDelay() / 1e3}s</span>
      </div>
    `;
      const speedSlider = document.createElement("input");
      speedSlider.type = "range";
      speedSlider.min = "2000";
      speedSlider.max = "20000";
      speedSlider.value = stateManager.getMaxDelay();
      speedSlider.step = "500";
      Object.assign(speedSlider.style, { width: "100%", cursor: "pointer" });
      speedSlider.addEventListener("input", () => {
        const max = parseInt(speedSlider.value);
        const min = Math.max(2e3, max - 5e3);
        stateManager.setDelayRange(min, max);
        document.getElementById("boss-auto-delay-label").textContent = `${(min / 1e3).toFixed(1)}\u2013${(max / 1e3).toFixed(1)}s`;
      });
      speedRow.appendChild(speedSlider);
      const logHeader = document.createElement("div");
      Object.assign(logHeader.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "4px"
      });
      logHeader.innerHTML = '<span style="font-size:12px;font-weight:500;">\u{1F4CB} \u65E5\u5FD7</span>';
      const copyLogBtn = document.createElement("button");
      copyLogBtn.textContent = "\u590D\u5236";
      Object.assign(copyLogBtn.style, {
        background: "#f0f0f0",
        border: "1px solid #d9d9d9",
        borderRadius: "4px",
        padding: "2px 8px",
        cursor: "pointer",
        fontSize: "11px"
      });
      copyLogBtn.addEventListener("click", () => {
        if (!this.logContainer) return;
        const lines = [];
        for (const child of this.logContainer.children) {
          if (child.textContent && child.textContent !== "\u7B49\u5F85\u64CD\u4F5C...") {
            lines.push(child.textContent);
          }
        }
        if (lines.length === 0) return;
        navigator.clipboard?.writeText(lines.join("\n")).then(() => {
          copyLogBtn.textContent = "\u2705";
          setTimeout(() => {
            copyLogBtn.textContent = "\u590D\u5236";
          }, 1500);
        }).catch(() => {
          const ta = document.createElement("textarea");
          ta.value = lines.join("\n");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          copyLogBtn.textContent = "\u2705";
          setTimeout(() => {
            copyLogBtn.textContent = "\u590D\u5236";
          }, 1500);
        });
      });
      logHeader.appendChild(copyLogBtn);
      const logSection = document.createElement("div");
      Object.assign(logSection.style, {
        maxHeight: "120px",
        overflowY: "auto",
        background: "#fafafa",
        borderRadius: "6px",
        padding: "8px",
        fontSize: "11px",
        fontFamily: "monospace",
        lineHeight: "1.5"
      });
      this.logContainer = logSection;
      logSection.innerHTML = '<div style="color:#999;">\u7B49\u5F85\u64CD\u4F5C...</div>';
      body.appendChild(this.statusText);
      body.appendChild(progressSection);
      body.appendChild(buttonGroup);
      body.appendChild(toggleRow);
      body.appendChild(dbRow);
      const filterRow = document.createElement("div");
      Object.assign(filterRow.style, { padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: "12px" });
      const profile = loadProfile();
      const summary = getProfileSummary(profile);
      filterRow.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span>\u{1F3AF} \u7B5B\u9009\u753B\u50CF</span><span id="boss-auto-profile-status">' + (summary ? "\u2705 " + summary.candidateCount + "\u4EBA\u753B\u50CF" : "\u26A0 \u672A\u52A0\u8F7D") + '</span></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;gap:6px;"><span>\u5206\u6570\u7EBF</span><input id="boss-auto-min-score" type="number" min="0" max="100" value="' + getMinScore() + '" style="width:42px;font-size:11px;border:1px solid #d9d9d9;border-radius:3px;padding:1px 4px;text-align:center;" title="\u6700\u4F4E\u5206\u6570\u7EBF"><span>\u5206</span><button id="boss-auto-learn" style="margin-left:auto;background:#1677ff;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;">\u5B66\u4E60\u753B\u50CF</button></div>';
      body.appendChild(filterRow);
      body.appendChild(speedRow);
      body.appendChild(logHeader);
      body.appendChild(logSection);
      panel.appendChild(header);
      panel.appendChild(body);
      const resizeHandle = document.createElement("div");
      Object.assign(resizeHandle.style, {
        position: "absolute",
        bottom: "0",
        right: "0",
        width: "16px",
        height: "16px",
        cursor: "nwse-resize",
        background: "linear-gradient(135deg, transparent 50%, #ccc 50%)",
        borderRadius: "0 0 12px 0"
      });
      resizeHandle.addEventListener("mousedown", this._onResizeStart.bind(this));
      document.addEventListener("mousemove", this._onResizeMove.bind(this));
      document.addEventListener("mouseup", this._onResizeEnd.bind(this));
      panel.appendChild(resizeHandle);
      header.querySelector("#boss-auto-minimize").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMinimize();
      });
      header.querySelector("#boss-auto-close").addEventListener("click", (e) => {
        e.stopPropagation();
        this._eventBus?.emit(EVENTS.STOP);
        panel.style.display = "none";
      });
      const scoreInput = document.getElementById("boss-auto-min-score");
      if (scoreInput) {
        scoreInput.addEventListener("change", () => {
          const v = parseInt(scoreInput.value) || 40;
          const clamped = Math.max(0, Math.min(100, v));
          setMinScore(clamped);
          scoreInput.value = clamped;
        });
      }
      const learnBtn = document.getElementById("boss-auto-learn");
      if (learnBtn) {
        learnBtn.addEventListener("click", () => {
          const cards = cardScanner.scanCards();
          if (cards.length === 0) {
            logger.warn("\u672A\u627E\u5230\u5019\u9009\u4EBA\u5361\u7247\uFF0C\u65E0\u6CD5\u5B66\u4E60");
            return;
          }
          const newProfile = buildProfile(cards);
          if (newProfile) {
            saveProfile(newProfile);
            const summary2 = getProfileSummary(newProfile);
            const statusEl = document.getElementById("boss-auto-profile-status");
            if (statusEl && summary2) statusEl.textContent = "\u2705 " + summary2.candidateCount + "\u4EBA\u753B\u50CF";
            logger.success("\u7B5B\u9009\u753B\u50CF\u5DF2\u66F4\u65B0\uFF01\u5206\u6790 " + newProfile.candidateCount + " \u4EBA\uFF0C\u5173\u952E\u6280\u80FD: " + (summary2?.topSkills || ""));
            this.updateProgress();
          }
        });
      }
      return panel;
    }
    _createButton(text, color, onClick) {
      const btn = document.createElement("button");
      btn.textContent = text;
      Object.assign(btn.style, {
        padding: "8px 12px",
        background: color,
        color: "#fff",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: "500",
        transition: "opacity 0.2s"
      });
      btn.addEventListener("click", onClick);
      btn.addEventListener("mouseenter", () => {
        btn.style.opacity = "0.85";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.opacity = "1";
      });
      return btn;
    }
    /**
     * 更新状态显示
     */
    updateStatus(state) {
      if (!this.statusText) return;
      const currentState = state || stateManager.getRunState();
      const configs = {
        [RUN_STATES.IDLE]: { text: "\u23F3 \u5C31\u7EEA - \u7B49\u5F85\u5F00\u59CB", bg: "#f0f0f0", color: "#666" },
        [RUN_STATES.RUNNING]: { text: "\u{1F7E2} \u8FD0\u884C\u4E2D...", bg: "#f6ffed", color: "#52c41a" },
        [RUN_STATES.PAUSED]: { text: "\u{1F7E1} \u5DF2\u6682\u505C", bg: "#fffbe6", color: "#faad14" },
        [RUN_STATES.STOPPED]: { text: "\u23F9 \u5DF2\u505C\u6B62", bg: "#fff2f0", color: "#ff4d4f" }
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
      this.statusText.textContent = "\u{1F916} \u68C0\u6D4B\u5230\u9A8C\u8BC1\u7801\uFF01\u8BF7\u624B\u52A8\u5B8C\u6210\u6ED1\u52A8\u9A8C\u8BC1";
      this.statusText.style.background = "#fff2e8";
      this.statusText.style.color = "#d4380d";
      this.statusText.style.animation = "boss-auto-blink 1s infinite";
      if (!document.getElementById("boss-auto-blink-style")) {
        const style = document.createElement("style");
        style.id = "boss-auto-blink-style";
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
      this.statusText.style.animation = "";
      this.updateStatus(RUN_STATES.RUNNING);
    }
    /**
     * 更新进度显示
     */
    updateProgress() {
      const greeted = stateManager.getTotalGreeted();
      const total = stateManager.getMaxPerSession();
      const textEl = document.getElementById("boss-auto-progress-text");
      if (textEl) textEl.textContent = `${greeted} / ${total}`;
      if (this.progressBar) {
        this.progressBar.style.width = `${Math.min(100, greeted / total * 100)}%`;
      }
    }
    /**
     * 追加日志行到面板
     */
    appendLog(entry) {
      if (!this.logContainer) return;
      const colors = {
        DEBUG: "#999",
        INFO: "#333",
        SUCCESS: "#52c41a",
        WARN: "#faad14",
        ERROR: "#ff4d4f",
        CAPTCHA: "#d4380d"
      };
      const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN");
      const line = document.createElement("div");
      line.style.color = colors[entry.level] || "#333";
      line.textContent = `[${time}] ${entry.message}`;
      this.logContainer.appendChild(line);
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
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
      logger.onLog((entry) => {
        this.appendLog(entry);
      });
      this.updateDBStats();
    }
    updateDBStats() {
      candidateDB.load();
      const total = candidateDB.count();
      const today = candidateDB.todayCount();
      const el = document.getElementById("boss-auto-db-stats");
      if (el) el.textContent = `\u{1F4CA} \u603B${total}\u6761 / \u4ECA\u65E5${today}\u6761`;
    }
    /**
     * 折叠/展开面板
     */
    toggleMinimize() {
      const body = document.getElementById("boss-auto-body");
      if (!body) return;
      this.isMinimized = !this.isMinimized;
      body.style.display = this.isMinimized ? "none" : "";
      this.container.style.height = this.isMinimized ? "auto" : this.panelHeight + "px";
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
      this.container.style.width = this.panelWidth + "px";
      this.container.style.height = this.panelHeight + "px";
    }
    _onResizeEnd() {
      this.isResizing = false;
    }
    _onDragStart(e) {
      if (e.target.tagName === "BUTTON") return;
      this.isDragging = true;
      const rect = this.container.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      this.container.style.transition = "none";
    }
    _onDragMove(e) {
      if (!this.isDragging) return;
      this.container.style.left = e.clientX - this.dragOffset.x + "px";
      this.container.style.top = e.clientY - this.dragOffset.y + "px";
      this.container.style.right = "auto";
    }
    _onDragEnd() {
      if (this.isDragging) {
        this.isDragging = false;
        this.container.style.transition = "";
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
      document.removeEventListener("mousemove", this._onDragMove);
      document.removeEventListener("mouseup", this._onDragEnd);
    }
  };
  var uiPanel = new UIPanel();

  // src/net-capture.js
  var _hooked = false;
  function hookWindow(win, label) {
    try {
      const XHR = win.XMLHttpRequest;
      win.XMLHttpRequest = function() {
        const x = new XHR();
        let m, u;
        const oo = x.open;
        x.open = function(method, url, ...r) {
          m = method;
          u = url;
          return oo.apply(this, [method, url, ...r]);
        };
        const os = x.send;
        x.send = function(body) {
          x.addEventListener("loadend", () => {
            const url = String(u || "");
            if (/wapi|api|chat|recommend|geek|friend|sayhello|startchat|boss/i.test(url)) {
              let msg = "[NET " + label + " XHR] " + m + " " + url.slice(0, 100);
              if (body) msg += "\n  >>> " + String(body).slice(0, 1e3);
              if (x.responseText) msg += "\n  <<< " + String(x.responseText).slice(0, 1e3);
              logger.info(msg);
            }
          });
          return os.call(this, body);
        };
        return x;
      };
      win.XMLHttpRequest.prototype = XHR.prototype;
      const OF = win.fetch;
      win.fetch = function(...args) {
        const url = String(args[0]?.url || args[0] || "");
        const method = args[1]?.method || "GET";
        const body = args[1]?.body;
        return OF.apply(this, args).then(async (r) => {
          if (/wapi|api|chat|recommend|geek|friend|sayhello|startchat|boss/i.test(url)) {
            const txt = await r.clone().text().catch(() => "");
            let msg = "[NET " + label + " FETCH] " + method + " " + url.slice(0, 100);
            if (body) msg += "\n  >>> " + String(body).slice(0, 1e3);
            if (txt) msg += "\n  <<< " + txt.slice(0, 1e3);
            logger.info(msg);
          }
          return r;
        });
      };
    } catch (e) {
      logger.debug("hookWindow " + label + " failed: " + e.message);
    }
  }
  function startNetCapture() {
    if (_hooked) return;
    _hooked = true;
    hookWindow(window, "MAIN");
    logger.info("\u7F51\u7EDC\u6355\u83B7\u5DF2\u542F\u52A8 (MAIN)");
    const tryHookIframe = () => {
      const iframes = document.querySelectorAll("iframe");
      for (const f of iframes) {
        if (f.src && f.src.includes("/web/frame/recommend") && f.contentWindow) {
          try {
            hookWindow(f.contentWindow, "IFRAME");
            logger.info("\u7F51\u7EDC\u6355\u83B7\u5DF2\u542F\u52A8 (IFRAME)");
            return;
          } catch (e) {
          }
        }
      }
      setTimeout(tryHookIframe, 1e3);
    };
    setTimeout(tryHookIframe, 2e3);
  }

  // src/core.js
  var EventBus = class {
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
          logger.error(`\u4E8B\u4EF6\u5904\u7406\u5668\u9519\u8BEF [${event}]`, e.message);
        }
      }
    }
  };
  var AppCore = class {
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
      logger.info("BOSS \u81EA\u52A8\u6C9F\u901A\u5DE5\u5177 v0.1.0 \u521D\u59CB\u5316...");
      startNetCapture();
      if (!cardScanner.isInIframe()) {
        logger.info("\u68C0\u6D4B\u5230\u7236\u9875\u9762\uFF0C\u7B49\u5F85\u63A8\u8350iframe\u52A0\u8F7D...");
        const iframeDoc = await cardScanner.waitForIframe(15e3);
        if (!iframeDoc) {
          logger.error("\u65E0\u6CD5\u52A0\u8F7D\u63A8\u8350iframe\uFF0C\u8BF7\u786E\u8BA4\u9875\u9762\u5DF2\u5B8C\u5168\u52A0\u8F7D");
          return;
        }
      } else {
        logger.info("\u68C0\u6D4B\u5230iframe\u9875\u9762\uFF0C\u76F4\u63A5\u521D\u59CB\u5316...");
      }
      stateManager.init();
      actionEngine.setEventBus(this.eventBus);
      uiPanel.mount(this.eventBus);
      this._registerEvents();
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
        targetDoc
        // 监控iframe内的验证码
      );
      this._visibilityHandler = setupVisibilityHandler(
        () => {
          if (stateManager.getRunState() === RUN_STATES.RUNNING) {
            actionEngine.pause();
          }
        },
        () => {
          logger.info('\u6807\u7B7E\u9875\u6062\u590D\u53EF\u89C1\uFF0C\u8BF7\u624B\u52A8\u70B9\u51FB"\u7EE7\u7EED"\u4EE5\u6062\u590D\u81EA\u52A8\u5316');
        }
      );
      try {
        const cards = cardScanner.scanCards();
        logger.info(`\u521D\u59CB\u5316\u5B8C\u6210\uFF0C\u68C0\u6D4B\u5230 ${cards.length} \u4F4D\u5019\u9009\u4EBA`, {
          dryRun: stateManager.isDryRun(),
          delay: `${stateManager.getMinDelay() / 1e3}-${stateManager.getMaxDelay() / 1e3}s`
        });
      } catch (e) {
        logger.warn("\u521D\u59CB\u5361\u7247\u626B\u63CF\u4E0D\u5B8C\u6574", e.message);
      }
      this._initialized = true;
      logger.connectWS();
      logger.success("\u2705 \u5DE5\u5177\u5C31\u7EEA\uFF01");
      logger.info('\u8BF7\u68C0\u67E5\u63A7\u5236\u9762\u677F\uFF0C\u70B9\u51FB"\u5F00\u59CB"\u542F\u52A8\u81EA\u52A8\u5316');
      if (stateManager.isDryRun()) {
        logger.info("\u{1F7E1} \u5F53\u524D\u4E3A Dry-run (\u6F14\u7EC3) \u6A21\u5F0F\uFF0C\u4E0D\u4F1A\u771F\u5B9E\u53D1\u9001\u6D88\u606F");
      }
    }
    /**
     * 注册事件处理
     */
    _registerEvents() {
      const bus = this.eventBus;
      bus.on(EVENTS.START, async () => {
        if (stateManager.getRunState() === RUN_STATES.RUNNING) {
          logger.warn("\u5DF2\u5728\u8FD0\u884C\u4E2D");
          return;
        }
        await actionEngine.start();
      });
      bus.on(EVENTS.PAUSE, () => {
        if (stateManager.getRunState() === RUN_STATES.RUNNING) {
          actionEngine.pause();
        } else {
          logger.warn("\u5F53\u524D\u4E0D\u5728\u8FD0\u884C\u72B6\u6001");
        }
      });
      bus.on(EVENTS.RESUME, async () => {
        if (stateManager.getRunState() === RUN_STATES.PAUSED) {
          await actionEngine.resume();
        } else {
          logger.warn("\u5F53\u524D\u4E0D\u5728\u6682\u505C\u72B6\u6001");
        }
      });
      bus.on(EVENTS.STOP, () => {
        actionEngine.stop();
      });
      bus.on(EVENTS.CAPTCHA_DETECTED, () => {
        logger.captcha('\u8BF7\u624B\u52A8\u5B8C\u6210\u9A8C\u8BC1\u7801\u540E\u70B9\u51FB"\u7EE7\u7EED"');
      });
      bus.on(EVENTS.STATE_CHANGED, (state) => {
        uiPanel.updateStatus(state);
      });
      bus.on(EVENTS.LIMIT_REACHED, () => {
        logger.success("\u4F1A\u8BDD\u9650\u5236\u5DF2\u5230\u8FBE\uFF0C\u4ECA\u65E5\u6C9F\u901A\u5B8C\u6210");
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
      logger.info("\u5DE5\u5177\u5DF2\u5378\u8F7D");
    }
  };
  var appCore = new AppCore();

  // src/bootstrap.js
  function isRecommendPage() {
    const url = window.location.href;
    return url.includes("/web/chat/recommend") || url.includes("/web/frame/recommend");
  }
  function isInIframe() {
    return window.location.href.includes("/web/frame/recommend");
  }
  function waitForPageReady(timeout = 1e4) {
    return new Promise((resolve) => {
      if (document.readyState === "complete") {
        setTimeout(resolve, 1500);
        return;
      }
      const timer = setTimeout(resolve, timeout);
      window.addEventListener("load", () => {
        clearTimeout(timer);
        setTimeout(resolve, 1500);
      }, { once: true });
    });
  }
  async function main() {
    if (isInIframe()) {
      console.log("[BOSS-Auto] iframe\u9875\u9762\uFF0C\u8DF3\u8FC7\u521D\u59CB\u5316\uFF08\u7531\u7236\u9875\u9762\u63A7\u5236\uFF09");
      return;
    }
    if (!isRecommendPage()) {
      logger.debug("\u975E\u63A8\u8350\u9875\u9762\uFF0C\u8DF3\u8FC7\u521D\u59CB\u5316");
      return;
    }
    await waitForPageReady();
    appCore.init();
  }
  main().catch((e) => {
    console.error("[BOSS-Auto] \u542F\u52A8\u5931\u8D25:", e);
  });
})();
