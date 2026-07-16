// ==UserScript==
// @name         猎聘推荐页自动沟通
// @namespace    https://github.com/liepin-recommend-auto
// @version      0.1.0
// @description  在猎聘推荐页面(lpt.liepin.com/recommend)自动向推荐候选人发起沟通
// @author       Auto Tools
// @match        https://lpt.liepin.com/recommend*
// @match        https://lpt.liepin.com/recommend?*
// @match        https://lpt.liepin.com/recommend/intentionCandidate*
// @icon         https://lpt.liepin.com/favicon.ico
// @grant        unsafeWindow
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // liepin-src/constants.js
  var PAGE_URL_PATTERN, INTENTION_PAGE_PATTERN, REACT_INTERNAL_KEYS, MAX_CONSECUTIVE_FAILURES, STORAGE_KEY_STATE, STORAGE_KEY_CONFIG, EVENTS, RUN_STATES;
  var init_constants = __esm({
    "liepin-src/constants.js"() {
      PAGE_URL_PATTERN = "/recommend";
      INTENTION_PAGE_PATTERN = "/intentionCandidate";
      REACT_INTERNAL_KEYS = [
        "__reactInternalInstance$",
        "__reactFiber$"
      ];
      MAX_CONSECUTIVE_FAILURES = 5;
      STORAGE_KEY_STATE = "liepin_auto_state";
      STORAGE_KEY_CONFIG = "liepin_auto_config";
      EVENTS = {
        START: "liepin:start",
        PAUSE: "liepin:pause",
        RESUME: "liepin:resume",
        STOP: "liepin:stop",
        CARD_PROCESSED: "liepin:card-processed",
        CAPTCHA_DETECTED: "liepin:captcha-detected",
        CAPTCHA_RESOLVED: "liepin:captcha-resolved",
        ERROR: "liepin:error",
        LIMIT_REACHED: "liepin:limit-reached",
        STATE_CHANGED: "liepin:state-changed",
        DB_UPDATED: "liepin:db-updated",
        LOG: "liepin:log"
      };
      RUN_STATES = {
        IDLE: "idle",
        RUNNING: "running",
        PAUSED: "paused",
        STOPPED: "stopped"
      };
    }
  });

  // liepin-src/intention-learner.js
  var intention_learner_exports = {};
  __export(intention_learner_exports, {
    buildProfile: () => buildProfile,
    getProfileSummary: () => getProfileSummary,
    hasProfile: () => hasProfile,
    initIntentionLearner: () => initIntentionLearner,
    loadProfile: () => loadProfile,
    saveProfile: () => saveProfile
  });
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
      "\u7B49\u65B9",
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
  function analyzeDegrees(candidates) {
    const dist = {};
    for (const c of candidates) {
      const d = c.eduLevelDesc || "\u672A\u77E5";
      dist[d] = (dist[d] || 0) + 1;
    }
    const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    return { distribution: sorted, minRequired: sorted[0]?.[0] || "\u672C\u79D1" };
  }
  function analyzeWorkYears(candidates) {
    const years = candidates.map((c) => parseInt(c.workYearDesc) || 0).filter((y) => y > 0);
    if (years.length === 0) return { min: 1, max: 10, avg: 3 };
    const sum = years.reduce((a, b) => a + b, 0);
    return {
      min: Math.min(...years),
      max: Math.max(...years),
      avg: Math.round(sum / years.length)
    };
  }
  function analyzeSchools(candidates) {
    let tier = 0;
    let has985211 = false;
    let hasOverseas = false;
    let hasRegular = false;
    for (const c of candidates) {
      const eduList = c.eduExpList || [];
      for (const edu of eduList) {
        const name = (edu.expName || "") + (edu.expSubTitle || "");
        if (/985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(name)) {
          has985211 = true;
        }
        if (/[a-zA-Z].*大学|University|College|Institute/i.test(name) && !/中国|师范|理工|工业|科技|农业|林业|海洋|民族|政法|财经|外国语|中医药|药科|邮电|电子|石油|化工|地质|矿业|电力|水利|建筑|交通|航空|航天|海洋|体育|音乐|美术|戏剧|电影|舞蹈/i.test(name)) {
          hasOverseas = true;
        }
        hasRegular = true;
      }
    }
    if (has985211 && hasOverseas) tier = 3;
    else if (has985211) tier = 2;
    else if (hasOverseas) tier = 3;
    else if (hasRegular) tier = 1;
    return { tier, has985211, hasOverseas };
  }
  function analyzeSalary(candidates) {
    let minSal = Infinity, maxSal = 0;
    for (const c of candidates) {
      const s = c.salaryDesc || "";
      const match = s.match(/(\d+)-(\d+)/);
      if (match) {
        minSal = Math.min(minSal, parseInt(match[1]));
        maxSal = Math.max(maxSal, parseInt(match[2]));
      }
    }
    return {
      min: minSal === Infinity ? 0 : minSal,
      max: maxSal === 0 ? 5e4 : maxSal
    };
  }
  function analyzeCities(candidates) {
    const dist = {};
    for (const c of candidates) {
      const city = c.dqName || c.dqClarification?.dqName || "\u672A\u77E5";
      dist[city] = (dist[city] || 0) + 1;
    }
    return Object.entries(dist).sort((a, b) => b[1] - a[1]);
  }
  function analyzeIndustry(candidates) {
    const allReasons = candidates.map((c) => c.matchReason || "").filter(Boolean);
    const keywords = extractKeywords(allReasons, []);
    return keywords.slice(0, 20);
  }
  function buildProfile(candidates) {
    if (!candidates || candidates.length === 0) return null;
    const reasons = candidates.map((c) => c.matchReason || "");
    const titles = candidates.map((c) => c.ejobTitle || "");
    const allText = [...reasons, ...titles];
    const keywords = extractKeywords(reasons, []);
    const skillKeywords = keywords.filter(
      (k) => !/^\d/.test(k.word) && !/年|月|日/.test(k.word) && k.word.length >= 2
    ).slice(0, 30);
    const degrees = analyzeDegrees(candidates);
    const workYears = analyzeWorkYears(candidates);
    const schools = analyzeSchools(candidates);
    const salary = analyzeSalary(candidates);
    const cities = analyzeCities(candidates);
    const industry = analyzeIndustry(candidates);
    const profile = {
      createdAt: Date.now(),
      source: "intention_candidates",
      candidateCount: candidates.length,
      jobTitle: candidates[0]?.ejobTitle || "",
      // 技能关键词 (权重最高)
      skillKeywords: skillKeywords.map((k) => k.word),
      // 学历要求
      degreeRequired: degrees.minRequired,
      degreeDistribution: degrees.distribution,
      // 经验要求
      workYearsMin: workYears.min,
      workYearsMax: workYears.max,
      workYearsAvg: workYears.avg,
      // 学校层次
      schoolTier: schools.tier,
      prefer985211: schools.has985211,
      preferOverseas: schools.hasOverseas,
      // 薪资范围
      salaryMin: salary.min,
      salaryMax: salary.max,
      // 目标城市
      targetCities: cities.slice(0, 5).map(([city]) => city),
      // 行业关键词
      industryKeywords: industry.map((k) => k.word),
      // 原始数据摘要
      sampleCandidates: candidates.slice(0, 3).map((c) => ({
        name: c.userName,
        age: c.ageDesc,
        degree: c.eduLevelDesc,
        workYears: c.workYearDesc,
        school: c.eduExpList?.[0]?.expName || "",
        reason: c.matchReason || ""
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
  function hasProfile() {
    return !!localStorage.getItem(PROFILE_KEY);
  }
  function initIntentionLearner() {
    const OX = XMLHttpRequest;
    const origSend = OX.prototype.send;
    OX.prototype.send = function(body) {
      const xhr = this;
      xhr.addEventListener("loadend", () => {
        try {
          const url = String(xhr._lp_url || "");
          if (url.includes("get-candidate-list")) {
            const data = JSON.parse(xhr.responseText);
            if (data?.flag === 1 && Array.isArray(data?.data)) {
              const candidates = data.data;
              const profile = buildProfile(candidates);
              if (profile) {
                saveProfile(profile);
                showLearnNotification(profile);
              }
            }
          }
        } catch (e) {
        }
      });
      return origSend.call(this, body);
    };
    const origOpen = OX.prototype.open;
    OX.prototype.open = function(method, url) {
      this._lp_url = url;
      return origOpen.apply(this, arguments);
    };
    const OF = window.fetch;
    window.fetch = function() {
      const args = arguments;
      const url = String(args[0]?.url || args[0] || "");
      return OF.apply(this, args).then(async (r) => {
        if (url.includes("get-candidate-list")) {
          const clone = r.clone();
          try {
            const data = await clone.json();
            if (data?.flag === 1 && Array.isArray(data?.data)) {
              const profile = buildProfile(data.data);
              if (profile) {
                saveProfile(profile);
                showLearnNotification(profile);
              }
            }
          } catch (e) {
          }
        }
        return r;
      });
    };
  }
  function showLearnNotification(profile) {
    const summary = getProfileSummary(profile);
    if (!summary) return;
    const existing = document.getElementById("liepin-learn-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "liepin-learn-toast";
    toast.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#52c41a;padding:14px 20px;border-radius:8px;z-index:9999999;font:13px/1.6 sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.5);text-align:center;";
    toast.innerHTML = "<b>\u2705 \u7B5B\u9009\u753B\u50CF\u5DF2\u751F\u6210\uFF01</b><br>\u804C\u4F4D: " + summary.jobTitle + "<br>\u5206\u6790\u5019\u9009\u4EBA: " + summary.candidateCount + "\u4EBA<br>\u5173\u952E\u6280\u80FD: " + summary.topSkills + "<br>\u5B66\u5386\u8981\u6C42: " + summary.degree + " | \u7ECF\u9A8C: " + summary.workYears + "<br>\u76EE\u6807\u57CE\u5E02: " + summary.cities + '<br><span style="color:#fa8c16;">\u73B0\u5728\u53BB\u63A8\u8350\u9875\u5373\u53EF\u6309\u6B64\u753B\u50CF\u7B5B\u9009</span>';
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 8e3);
  }
  function getProfileSummary(profile) {
    if (!profile) return null;
    return {
      candidateCount: profile.candidateCount,
      jobTitle: profile.jobTitle,
      topSkills: profile.skillKeywords?.slice(0, 8).join("\u3001"),
      degree: profile.degreeRequired,
      workYears: `${profile.workYearsMin}-${profile.workYearsMax}\u5E74`,
      cities: profile.targetCities?.slice(0, 3).join("\u3001"),
      createdAt: new Date(profile.createdAt).toLocaleString("zh-CN")
    };
  }
  var PROFILE_KEY;
  var init_intention_learner = __esm({
    "liepin-src/intention-learner.js"() {
      PROFILE_KEY = "liepin_filter_profile";
    }
  });

  // liepin-src/logger.js
  var MAX_BUFFER_SIZE, Logger, logger;
  var init_logger = __esm({
    "liepin-src/logger.js"() {
      MAX_BUFFER_SIZE = 500;
      Logger = class {
        constructor() {
          this.buffer = [];
          this.listeners = [];
          this.wsConnection = null;
        }
        onLog(callback) {
          this.listeners.push(callback);
          return () => {
            this.listeners = this.listeners.filter((cb) => cb !== callback);
          };
        }
        _notify(entry) {
          for (const cb of this.listeners) {
            try {
              cb(entry);
            } catch (e) {
            }
          }
        }
        _write(level, message, data) {
          const entry = { timestamp: Date.now(), level, message, data: data || null };
          if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
          this.buffer.push(entry);
          const prefix = { DEBUG: "\u{1F50D}", INFO: "\u2139\uFE0F", SUCCESS: "\u2705", WARN: "\u26A0\uFE0F", ERROR: "\u274C", CAPTCHA: "\u{1F916}" }[level] || "";
          console.log(`[Liepin-Auto] ${prefix} ${message}`, data !== null ? data : "");
          this._notify(entry);
        }
        debug(m, d) {
          this._write("DEBUG", m, d);
        }
        info(m, d) {
          this._write("INFO", m, d);
        }
        success(m, d) {
          this._write("SUCCESS", m, d);
        }
        warn(m, d) {
          this._write("WARN", m, d);
        }
        error(m, d) {
          this._write("ERROR", m, d);
        }
        captcha(m, d) {
          this._write("CAPTCHA", m, d);
        }
        getRecent(n = 20) {
          return this.buffer.slice(-n);
        }
        getAll() {
          return [...this.buffer];
        }
        exportJSON() {
          return JSON.stringify(this.buffer, null, 2);
        }
        exportText() {
          return this.buffer.map((e) => {
            const time = new Date(e.timestamp).toLocaleTimeString("zh-CN");
            return `[${time}] [${e.level}] ${e.message}`;
          }).join("\n");
        }
        connectWS(url = "ws://localhost:9999") {
          try {
            this.wsConnection = new WebSocket(url);
            this.wsConnection.onopen = () => this.info("\u5DF2\u8FDE\u63A5\u5230\u76D1\u63A7\u670D\u52A1\u5668");
            this.wsConnection.onerror = () => {
              this.wsConnection = null;
            };
          } catch (e) {
          }
        }
        clear() {
          this.buffer = [];
        }
      };
      logger = new Logger();
    }
  });

  // liepin-src/state-manager.js
  var DEFAULT_STATE, DEFAULT_CONFIG, StateManager, stateManager;
  var init_state_manager = __esm({
    "liepin-src/state-manager.js"() {
      init_constants();
      DEFAULT_STATE = {
        processedCandidates: [],
        sessionStartTime: null,
        totalGreeted: 0,
        runState: RUN_STATES.IDLE,
        failureCount: 0,
        captchaCount: 0,
        lastActionTime: null
      };
      DEFAULT_CONFIG = {
        minDelay: 3e3,
        maxDelay: 8e3,
        autoScroll: true,
        dryRun: true,
        greetingTemplate: "",
        maxPerSession: 30
      };
      StateManager = class {
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
          } catch (e) {
          }
          try {
            const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
            if (saved) this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
          } catch (e) {
          }
        }
        persist() {
          try {
            localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(this.state));
          } catch (e) {
          }
          try {
            localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
          } catch (e) {
          }
        }
        getRunState() {
          return this.state.runState;
        }
        setRunState(s) {
          this.state.runState = s;
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
        markProcessed(id) {
          if (!this.state.processedCandidates.includes(id)) {
            this.state.processedCandidates.push(id);
            this.persist();
          }
        }
        isProcessed(id) {
          return this.state.processedCandidates.includes(id);
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
        isDryRun() {
          return this.config.dryRun;
        }
        setDryRun(v) {
          this.config.dryRun = v;
          this.persist();
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
        getMaxPerSession() {
          return this.config.maxPerSession;
        }
        setMaxPerSession(n) {
          this.config.maxPerSession = n;
          this.persist();
        }
        hasReachedLimit() {
          return this.state.totalGreeted >= this.config.maxPerSession;
        }
        startSession() {
          this.state.sessionStartTime = Date.now();
          this.state.totalGreeted = 0;
          this.state.failureCount = 0;
          this.state.captchaCount = 0;
          this.setRunState(RUN_STATES.RUNNING);
          this.persist();
        }
        resetAll() {
          this.state = { ...DEFAULT_STATE };
          this.persist();
        }
      };
      stateManager = new StateManager();
    }
  });

  // liepin-src/card-scanner.js
  var CardScanner, cardScanner;
  var init_card_scanner = __esm({
    "liepin-src/card-scanner.js"() {
      init_constants();
      init_logger();
      CardScanner = class {
        constructor() {
          this.currentCards = [];
          this.seenIds = /* @__PURE__ */ new Set();
          this._jobData = null;
        }
        /**
         * 扫描页面所有候选人卡片
         */
        scanCards() {
          const doc = document;
          const cards = [];
          const chatBtns = this._findChatButtons(doc);
          logger.info("\u627E\u5230 " + chatBtns.length + ' \u4E2A"\u7ACB\u5373\u6C9F\u901A"\u6309\u94AE');
          for (const btn of chatBtns) {
            const card = this._parseCard(btn);
            if (card) cards.push(card);
          }
          if (!this._jobData && cards.length > 0) {
            this._jobData = cards[0].jobData || null;
          }
          if (this._jobData) {
            for (const c of cards) {
              if (!c.ejobId) {
                c.ejobId = this._jobData.ejobId;
                c.jobKind = this._jobData.jobKind;
              }
            }
          }
          this.currentCards = cards;
          for (const card of cards) {
            if (!this.seenIds.has(card.id)) {
              this.seenIds.add(card.id);
              logger.debug("found: " + card.name + " - " + (card.expectPosition || "").slice(0, 30));
            }
          }
          return cards;
        }
        /**
         * 找所有"立即沟通"按钮 (排除"超级聊聊")
         */
        _findChatButtons(doc) {
          const allBtns = doc.querySelectorAll("button");
          const chatBtns = [];
          for (const btn of allBtns) {
            const text = (btn.textContent || "").trim();
            const tlgId = btn.getAttribute("data-tlg-elem-id") || "";
            if (text === "\u7ACB\u5373\u6C9F\u901A" && tlgId.indexOf("chat_btn") !== -1) {
              chatBtns.push(btn);
            }
          }
          return chatBtns;
        }
        /**
         * 解析单张卡片
         */
        _parseCard(btnElement) {
          try {
            let fiber = null;
            for (const key of REACT_INTERNAL_KEYS) {
              if (btnElement[key]) {
                fiber = btnElement[key];
                break;
              }
              for (const k in btnElement) {
                if (k.indexOf(key) === 0) {
                  fiber = btnElement[k];
                  break;
                }
              }
              if (fiber) break;
            }
            if (!fiber) return null;
            let node = fiber;
            let dataProps = null;
            let greetHandler = null;
            while (node) {
              const mp = node.memoizedProps || {};
              if (!dataProps && mp.data && typeof mp.data === "object" && mp.data.enresId) {
                dataProps = mp;
              }
              if (!greetHandler && typeof mp.onClick === "function") {
                greetHandler = mp.onClick;
              }
              if (dataProps && greetHandler) break;
              node = node.return;
            }
            if (!dataProps) return null;
            const d = dataProps.data;
            const name = d.showName || "";
            const id = d.enresId || d.enusercId || "card_" + Math.random().toString(36).slice(2);
            let education = "";
            if (d.eduExpList && d.eduExpList.length > 0) {
              const edu = d.eduExpList[0];
              education = [edu.redSchool, edu.redSpecial, edu.redDegreeName].filter(Boolean).join(" / ");
            }
            let lastWork = "";
            if (d.workExpList && d.workExpList.length > 0) {
              const w = d.workExpList[0];
              lastWork = [w.rwdCompname, w.rwdsTitle].filter(Boolean).join(" \xB7 ");
            }
            const expectLocation = d.jobWant?.wantDqName || "";
            const expectPosition = d.jobWant?.wantTitle || "";
            const labels = Array.isArray(d.label) ? d.label.filter(Boolean).slice(0, 5).join("\u3001") : "";
            const activeTime = d.activeStatus || d.activeTimeDesc || "";
            return {
              element: btnElement,
              id,
              name,
              title: labels,
              description: labels,
              // 基本信息
              ageDesc: d.showAge || "",
              gender: d.sexCode || "",
              workYears: d.workYearsShow || "",
              degree: d.eduLevelShow || "",
              education,
              lastWork,
              expectLocation,
              expectPosition,
              activeTime,
              cityName: d.cityName || "",
              // API 需要的参数
              enusercId: d.enusercId || "",
              enresId: d.enresId || "",
              imId: d.imId || "",
              headId: d.headId || "",
              // 职位数据
              ejobId: dataProps.jobId || dataProps.ejobId || "",
              jobKind: dataProps.jobKind || "2",
              sfrom: dataProps.sfrom || "R_HOMEPAGE_RECMD",
              usercId: dataProps.usercId || "",
              // React handler (降级用)
              greetHandler,
              // 原始数据引用
              _rawData: d,
              _rawProps: dataProps
            };
          } catch (e) {
            logger.debug("card parse error: " + e.message);
            return null;
          }
        }
        /**
         * 从页面获取全局职位数据
         */
        fetchJobData() {
          try {
            if (this._jobData) return this._jobData;
            const cards = this.currentCards;
            if (cards.length > 0) {
              return {
                ejobId: cards[0].ejobId,
                jobKind: cards[0].jobKind || "2"
              };
            }
          } catch (e) {
            logger.debug("fetchJobData error: " + e.message);
          }
          return null;
        }
        /**
         * 尝试从网络拦截获取职位数据
         */
        _hookForJobData() {
          const OF = window.fetch;
          window.fetch = function() {
            const args = arguments;
            const url = String(args[0]?.url || args[0] || "");
            return OF.apply(this, args).then(async (r) => {
              if (url.includes("recommend.init") || url.includes("get-recommend-resumes")) {
                const clone = r.clone();
                try {
                  const json = await clone.json();
                  if (json?.data?.ejobId) {
                    logger.info("\u6355\u83B7\u5230 ejobId: " + json.data.ejobId);
                  }
                  if (json?.data?.jobs) {
                  }
                } catch (e) {
                }
              }
              return r;
            });
          };
        }
        getAllCards() {
          return [...this.currentCards];
        }
        getUnprocessedCards(isProcessed) {
          return this.currentCards.filter((c) => !isProcessed(c.id));
        }
      };
      cardScanner = new CardScanner();
    }
  });

  // liepin-src/database.js
  var DB_KEY, CandidateDatabase, candidateDB;
  var init_database = __esm({
    "liepin-src/database.js"() {
      init_logger();
      DB_KEY = "liepin_auto_records";
      CandidateDatabase = class {
        constructor() {
          this.records = [];
          this._loaded = false;
        }
        load() {
          if (this._loaded) return;
          this._loaded = true;
          try {
            const raw = localStorage.getItem(DB_KEY);
            this.records = raw ? JSON.parse(raw) : [];
            logger.info("\u5DF2\u52A0\u8F7D " + this.records.length + " \u6761\u5386\u53F2\u6C9F\u901A\u8BB0\u5F55");
          } catch (e) {
            logger.warn("\u6570\u636E\u5E93\u52A0\u8F7D\u5931\u8D25");
            this.records = [];
          }
        }
        _persist() {
          try {
            localStorage.setItem(DB_KEY, JSON.stringify(this.records));
          } catch (e) {
          }
        }
        insert(record) {
          this.load();
          const entry = {
            id: record.id,
            name: record.name || "",
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
            activeTime: record.activeTime || "",
            cityName: record.cityName || ""
          };
          this.records.push(entry);
          this._persist();
          logger.debug("\u8BB0\u5F55\u5DF2\u4FDD\u5B58: " + record.name + " (\u603B\u8BA1 " + this.records.length + " \u6761)");
        }
        exists(id) {
          this.load();
          return this.records.some((r) => r.id === id);
        }
        count() {
          return this.records.length;
        }
        todayCount() {
          const today = /* @__PURE__ */ new Date();
          today.setHours(0, 0, 0, 0);
          const cutoff = today.getTime();
          return this.records.filter((r) => r.greetedAt >= cutoff).length;
        }
        getAll() {
          this.load();
          return [...this.records];
        }
        exportCSV() {
          this.load();
          const BOM = "\uFEFF";
          const header = "\u5E8F\u53F7,\u59D3\u540D,\u6027\u522B,\u5E74\u9F84,\u7ECF\u9A8C,\u5B66\u5386,\u6700\u8FD1\u5DE5\u4F5C,\u671F\u671B\u57CE\u5E02,\u671F\u671B\u804C\u4F4D,\u6240\u5728\u57CE\u5E02,\u6D3B\u8DC3\u65F6\u95F4,\u7B80\u4ECB,\u6C9F\u901A\u65F6\u95F4,\u62DB\u547C\u8BED\n";
          const rows = this.records.map((r, i) => {
            const time = new Date(r.greetedAt).toLocaleString("zh-CN");
            const desc = (r.description || "").replace(/"/g, '""');
            const greeting = (r.greetingSent || "").replace(/"/g, '""');
            const lastWork = (r.lastWork || "").replace(/"/g, '""');
            return `${i + 1},"${r.name}","${r.gender || ""}","${r.ageDesc || ""}","${r.workYears || ""}","${r.degree || ""}","${lastWork}","${r.expectLocation || ""}","${r.expectPosition || ""}","${r.cityName || ""}","${r.activeTime || ""}","${desc}","${time}","${greeting}"`;
          }).join("\n");
          return BOM + header + rows;
        }
        exportJSON() {
          this.load();
          return JSON.stringify(this.records, null, 2);
        }
        download(format = "csv") {
          const content = format === "json" ? this.exportJSON() : this.exportCSV();
          const ext = format === "json" ? "json" : "csv";
          const mime = format === "json" ? "application/json" : "text/csv;charset=utf-8";
          const filename = `liepin-candidates-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.${ext}`;
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
        clear() {
          this.records = [];
          this._persist();
          logger.warn("\u6570\u636E\u5E93\u5DF2\u6E05\u7A7A");
        }
      };
      candidateDB = new CandidateDatabase();
    }
  });

  // liepin-src/api-greet.js
  function extractParams(card) {
    return {
      enusercId: card.enusercId || "",
      enresId: card.enresId || "",
      imId: card.imId || "",
      headId: card.headId || "",
      ejobId: card.ejobId || "",
      jobKind: card.jobKind || "2",
      sfrom: card.sfrom || "R_HOMEPAGE_RECMD"
    };
  }
  async function checkTochat(oppositeUserIdEncode) {
    try {
      const formBody = new URLSearchParams();
      formBody.append("oppositeUserIdEncode", oppositeUserIdEncode);
      const resp = await fetch(BASE_URL + "/com.liepin.im.b.common.check-tochat", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        credentials: "include"
      });
      const data = await resp.json();
      return data.flag === 1;
    } catch (e) {
      logger.debug("check-tochat failed: " + e.message);
      return true;
    }
  }
  async function checkChatPrivilege(enusercId, ejobId, jobKind) {
    try {
      const formBody = new URLSearchParams();
      formBody.append("oppositeUserId", enusercId);
      formBody.append("jobId", ejobId);
      formBody.append("jobkind", jobKind);
      formBody.append("enumLpScene", "R_HOMEPAGE_RECMD");
      const resp = await fetch(BASE_URL + "/com.liepin.imbusiness.bpc.check-chat-privlege", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        credentials: "include"
      });
      const data = await resp.json();
      return {
        canChat: data?.data?.chatCheckResultCode === "can_chat",
        costCount: data?.data?.costCount || 0,
        leftCount: data?.data?.leftCount || 0
      };
    } catch (e) {
      logger.debug("check-chat-privlege failed: " + e.message);
      return { canChat: true };
    }
  }
  async function toChat2(params) {
    const ext = JSON.stringify({
      sourceCode: "R_HOMEPAGE_RECMD_LIST",
      head_id: params.headId
    });
    const formBody = new URLSearchParams();
    formBody.append("usercIdEncode", params.enusercId);
    formBody.append("ejobId", params.ejobId);
    formBody.append("source", params.sfrom);
    formBody.append("head_id", params.headId);
    formBody.append("ext", ext);
    const resp = await fetch(BASE_URL + "/com.liepin.im.b.chat.to-chat2", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      credentials: "include"
    });
    const data = await resp.json();
    return { success: data.flag === 1, data };
  }
  async function getSayHiText(imId, ejobId, jobKind) {
    try {
      const formBody = new URLSearchParams();
      formBody.append("oppositeImId", imId);
      formBody.append("jobKind", jobKind);
      formBody.append("jobId", ejobId);
      const resp = await fetch(BASE_URL + "/com.liepin.rim.b.sayhi.get-sayhi-b-v1", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        credentials: "include"
      });
      const data = await resp.json();
      return data?.data || "";
    } catch (e) {
      logger.debug("get-sayhi failed: " + e.message);
      return "";
    }
  }
  async function sendGreetAPI(card) {
    const params = extractParams(card);
    if (!params.enusercId) {
      return { success: false, error: "\u7F3A\u5C11\u53C2\u6570: enusercId" };
    }
    if (!params.ejobId) {
      return { success: false, error: "\u7F3A\u5C11\u53C2\u6570: ejobId" };
    }
    logger.debug("API\u6253\u62DB\u547C: enusercId=" + params.enusercId.slice(0, 15) + "... ejobId=" + params.ejobId + " headId=" + (params.headId || "").slice(0, 15) + "...");
    const canCheck = await checkTochat(params.enusercId);
    const priv = await checkChatPrivilege(params.enusercId, params.ejobId, params.jobKind);
    if (!priv.canChat) {
      return { success: false, error: "\u65E0\u6C9F\u901A\u6743\u9650: " + JSON.stringify(priv) };
    }
    const result = await toChat2(params);
    if (result.success) {
      let greeting = stateManager.getGreetingTemplate();
      if (!greeting && params.imId) {
        greeting = await getSayHiText(params.imId, params.ejobId, params.jobKind);
      }
      logger.success("API\u6253\u62DB\u547C\u6210\u529F: " + card.name + " (enusercId:" + params.enusercId.slice(0, 15) + "...)");
      return { success: true, data: result.data, greeting };
    } else {
      logger.error("to-chat2 \u5931\u8D25: " + JSON.stringify(result.data).slice(0, 300));
      return { success: false, error: "to-chat2-failed" };
    }
  }
  function extractProfile(card) {
    return {
      ageDesc: card.ageDesc || "",
      gender: card.gender || "",
      workYears: card.workYears || "",
      degree: card.degree || "",
      education: card.education || "",
      lastWork: card.lastWork || "",
      expectLocation: card.expectLocation || "",
      expectPosition: card.expectPosition || "",
      activeTime: card.activeTime || "",
      cityName: card.cityName || ""
    };
  }
  var BASE_URL;
  var init_api_greet = __esm({
    "liepin-src/api-greet.js"() {
      init_card_scanner();
      init_state_manager();
      init_logger();
      BASE_URL = "https://api-lpt.liepin.com/api";
    }
  });

  // liepin-src/candidate-scorer.js
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
      card.expectPosition || "",
      card.lastWork || "",
      card.education || "",
      card._rawData?.matchReason || ""
    ].join(" ").toLowerCase();
    let matched = 0;
    const keywords = profile.skillKeywords.slice(0, 15);
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) matched++;
    }
    if (keywords.length === 0) return _weights.skills * 0.5;
    const ratio = matched / keywords.length;
    return Math.round(_weights.skills * ratio);
  }
  function scoreDegree(card, profile) {
    const degreeOrder = ["\u9AD8\u4E2D", "\u5927\u4E13", "\u672C\u79D1", "\u7855\u58EB", "\u535A\u58EB", "MBA", "EMBA"];
    const cardDegree = card.degree || "";
    const requiredDegree = profile.degreeRequired || "\u672C\u79D1";
    const cardIdx = degreeOrder.findIndex((d) => cardDegree.includes(d));
    const reqIdx = degreeOrder.findIndex((d) => requiredDegree.includes(d));
    if (cardIdx === -1 || reqIdx === -1) return _weights.degree * 0.5;
    if (cardIdx >= reqIdx) return _weights.degree;
    if (cardIdx === reqIdx - 1) return Math.round(_weights.degree * 0.7);
    return Math.round(_weights.degree * 0.3);
  }
  function scoreSchool(card, profile) {
    if (!profile.prefer985211 && !profile.preferOverseas) return _weights.school * 0.6;
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
    if (!profile.targetCities || profile.targetCities.length === 0) return _weights.location * 0.5;
    const cardCities = [
      card.expectLocation || "",
      card.cityName || ""
    ].map((c) => c.toLowerCase());
    const targetCities = profile.targetCities.map((c) => c.toLowerCase());
    for (const tc of targetCities) {
      for (const cc of cardCities) {
        if (cc && tc && (cc.includes(tc) || tc.includes(cc))) {
          return _weights.location;
        }
      }
    }
    return 0;
  }
  function scorePosition(card, profile) {
    const positionText = [
      card.expectPosition || "",
      card.title || "",
      card.lastWork || ""
    ].join(" ").toLowerCase();
    const jobTitle = (profile.jobTitle || "").toLowerCase();
    const industryKeywords = profile.industryKeywords || [];
    const skillKeywords = profile.skillKeywords || [];
    const allKeywords = [.../* @__PURE__ */ new Set([...industryKeywords, ...skillKeywords])].slice(0, 10);
    let matched = 0;
    for (const kw of allKeywords) {
      if (positionText.includes(kw.toLowerCase())) matched++;
    }
    if (allKeywords.length === 0) return Math.round(_weights.position * 0.5);
    return Math.round(_weights.position * (matched / Math.min(5, allKeywords.length)));
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
      "facebook",
      "meta",
      "IBM",
      "\u7532\u9AA8\u6587",
      "\u4E2D\u91D1",
      "\u4E2D\u4FE1",
      "\u534E\u6CF0",
      "\u56FD\u6CF0\u541B\u5B89",
      "\u6D77\u901A",
      "\u5E7F\u53D1",
      "\u62DB\u5546",
      "\u5174\u4E1A",
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
    if (profile.sampleCandidates) {
      for (const sample of profile.sampleCandidates) {
        const sampleCompany = (sample.lastWork || "").toLowerCase();
        if (sampleCompany && companyText.includes(sampleCompany)) {
          score += _weights.company * 0.4;
          break;
        }
      }
    }
    return Math.min(_weights.company, score + Math.round(_weights.company * 0.1));
  }
  function scoreSalary(card, profile) {
    const rawData = card._rawData || {};
    const wantSalary = rawData.jobWant?.wantSalary || "";
    const match = wantSalary.match(/(\d+)-(\d+)/);
    if (!match) return Math.round(_weights.salary * 0.5);
    const cardMin = parseInt(match[1]);
    const cardMax = parseInt(match[2]);
    const profileMin = profile.salaryMin || 0;
    const profileMax = profile.salaryMax || 5e4;
    if (cardMax < profileMin || cardMin > profileMax) return 0;
    if (cardMin >= profileMin && cardMax <= profileMax) return _weights.salary;
    const overlap = Math.min(cardMax, profileMax) - Math.max(cardMin, profileMin);
    const cardRange = cardMax - cardMin || 1;
    return Math.round(_weights.salary * (overlap / cardRange));
  }
  function scoreCandidate(card, profile) {
    if (!profile) {
      return { total: 100, details: {}, passed: true, reason: "\u65E0\u753B\u50CF, \u4E0D\u8FC7\u6EE4" };
    }
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
    const passed = [];
    const rejected = [];
    for (const card of cards) {
      const result = scoreCandidate(card, profile);
      card._score = result;
      if (result.passed) {
        passed.push(card);
      } else {
        rejected.push(card);
      }
    }
    return { passed, rejected };
  }
  var DEFAULT_WEIGHTS, DEFAULT_MIN_SCORE, _weights, _minScore;
  var init_candidate_scorer = __esm({
    "liepin-src/candidate-scorer.js"() {
      init_intention_learner();
      DEFAULT_WEIGHTS = {
        skills: 30,
        // 技能关键词匹配
        degree: 10,
        // 学历匹配
        school: 10,
        // 学校层次
        workYears: 10,
        // 经验年限
        location: 10,
        // 城市匹配
        position: 15,
        // 职位关键词匹配
        company: 10,
        // 公司背景
        salary: 5
        // 薪资匹配
      };
      DEFAULT_MIN_SCORE = 40;
      _weights = { ...DEFAULT_WEIGHTS };
      _minScore = DEFAULT_MIN_SCORE;
    }
  });

  // liepin-src/action-engine.js
  var ActionEngine, actionEngine;
  var init_action_engine = __esm({
    "liepin-src/action-engine.js"() {
      init_constants();
      init_card_scanner();
      init_state_manager();
      init_logger();
      init_database();
      init_api_greet();
      init_intention_learner();
      init_candidate_scorer();
      ActionEngine = class {
        constructor() {
          this._eventBus = null;
          this._running = false;
          this._retryCount = 0;
        }
        setEventBus(bus) {
          this._eventBus = bus;
        }
        async start() {
          if (this._running) return;
          this._running = true;
          stateManager.startSession();
          this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
          logger.info(stateManager.isDryRun() ? "\u{1F7E1} Dry-run \u6A21\u5F0F\u542F\u52A8" : "\u{1F7E2} \u81EA\u52A8\u5316\u5DF2\u542F\u52A8");
          try {
            await this._mainLoop();
          } catch (e) {
            logger.error("\u4E3B\u5FAA\u73AF\u5F02\u5E38", e.message);
          } finally {
            this._running = false;
          }
        }
        pause() {
          this._running = false;
          stateManager.setRunState(RUN_STATES.PAUSED);
          this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.PAUSED);
          logger.warn("\u81EA\u52A8\u5316\u5DF2\u6682\u505C");
        }
        async resume() {
          if (this._running) return;
          this._running = true;
          stateManager.setRunState(RUN_STATES.RUNNING);
          this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.RUNNING);
          logger.info("\u81EA\u52A8\u5316\u5DF2\u6062\u590D");
          try {
            await this._mainLoop();
          } catch (e) {
            logger.error("\u4E3B\u5FAA\u73AF\u5F02\u5E38", e.message);
          } finally {
            this._running = false;
          }
        }
        stop() {
          this._running = false;
          stateManager.setRunState(RUN_STATES.STOPPED);
          this._eventBus?.emit(EVENTS.STATE_CHANGED, RUN_STATES.STOPPED);
          logger.info("\u81EA\u52A8\u5316\u5DF2\u505C\u6B62");
        }
        async _mainLoop() {
          let cardQueue = [];
          while (this._running && stateManager.getRunState() === RUN_STATES.RUNNING) {
            if (stateManager.hasReachedLimit()) {
              logger.success("\u8FBE\u5230\u4E0A\u9650\uFF0C\u505C\u6B62");
              this._eventBus?.emit(EVENTS.LIMIT_REACHED);
              this.stop();
              break;
            }
            if (stateManager.getFailureCount() >= MAX_CONSECUTIVE_FAILURES) {
              logger.error("\u8FDE\u7EED\u5931\u8D25\u8FC7\u591A\uFF0C\u505C\u6B62");
              this.stop();
              break;
            }
            if (cardQueue.length === 0) {
              const cards = cardScanner.scanCards();
              if (cards.length === 0) {
                logger.warn("\u672A\u627E\u5230\u5019\u9009\u4EBA\uFF0C3\u79D2\u540E\u91CD\u8BD5");
                await this._sleep(3e3);
                continue;
              }
              cardQueue = cards.filter((c) => !stateManager.isProcessed(c.id));
              if (cardQueue.length === 0) {
                logger.info("\u672C\u9875\u5019\u9009\u4EBA\u5DF2\u5168\u90E8\u5904\u7406\uFF0C\u6EDA\u52A8\u52A0\u8F7D\u66F4\u591A");
                window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                await this._sleep(2e3);
                const newCards = cardScanner.scanCards();
                cardQueue = newCards.filter((c) => !stateManager.isProcessed(c.id));
                if (cardQueue.length === 0) {
                  logger.info("\u6CA1\u6709\u66F4\u591A\u5019\u9009\u4EBA");
                  break;
                }
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
                  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                  await this._sleep(2e3);
                  continue;
                }
              } else {
                logger.info("\u65E0\u7B5B\u9009\u753B\u50CF\uFF0C\u4E0D\u8FC7\u6EE4");
              }
              logger.info("\u5F85\u5904\u7406: " + cardQueue.length + " \u4F4D\u5019\u9009\u4EBA");
            }
            const card = cardQueue.shift();
            logger.info("\u6C9F\u901A: " + card.name);
            const result = await this._greetCandidate(card);
            if (result.success) {
              stateManager.markProcessed(card.id);
              stateManager.incrementGreeted();
              stateManager.resetFailure();
              this._retryCount = 0;
              const profile = result.profile || extractProfile(card);
              candidateDB.insert({
                id: card.id,
                name: card.name,
                description: card.title || card.expectPosition,
                dryRun: stateManager.isDryRun(),
                greetingSent: result.greeting || "",
                ...profile
              });
              this._eventBus?.emit(EVENTS.CARD_PROCESSED);
              this._eventBus?.emit(EVENTS.DB_UPDATED);
              logger.success("ok: " + card.name + " (" + stateManager.getTotalGreeted() + "/" + stateManager.getMaxPerSession() + ")");
            } else {
              stateManager.incrementFailure();
              this._retryCount++;
              logger.error("fail: " + card.name + " - " + (result.error || ""));
            }
            await this._sleep(stateManager.getMinDelay() + Math.random() * (stateManager.getMaxDelay() - stateManager.getMinDelay()));
          }
          logger.info("\u4E3B\u5FAA\u73AF\u7ED3\u675F");
        }
        async _greetCandidate(card) {
          if (stateManager.isDryRun()) {
            logger.info("[DRY-RUN] \u6A21\u62DF\u6C9F\u901A: " + card.name);
            await this._sleep(1e3 + Math.random() * 1e3);
            return { success: true, message: "Dry-run\u6A21\u62DF\u6210\u529F", method: "dry-run" };
          }
          logger.debug("Tier 0: API\u76F4\u63A5\u6253\u62DB\u547C...");
          const apiResult = await sendGreetAPI(card);
          if (apiResult.success) {
            return { success: true, message: "API\u6210\u529F", method: "api", greeting: apiResult.greeting, profile: extractProfile(card) };
          }
          if (card.greetHandler) {
            logger.debug("API\u5931\u8D25\uFF0C\u5C1D\u8BD5React handler...");
            try {
              const fakeEvent = {
                stopPropagation: () => {
                },
                preventDefault: () => {
                },
                nativeEvent: { stopImmediatePropagation: () => {
                } },
                target: card.element,
                currentTarget: card.element,
                type: "click",
                button: 0
              };
              card.greetHandler(fakeEvent);
              await this._sleep(2e3);
              return { success: true, message: "React handler\u6210\u529F", method: "react-handler" };
            } catch (e) {
              logger.debug("React handler\u5931\u8D25: " + e.message);
            }
          }
          return { success: false, error: apiResult.error || "\u6240\u6709\u7B56\u7565\u5747\u5931\u8D25" };
        }
        _sleep(ms) {
          return new Promise((r) => setTimeout(r, ms));
        }
      };
      actionEngine = new ActionEngine();
    }
  });

  // liepin-src/ui-panel.js
  var UIPanel, uiPanel;
  var init_ui_panel = __esm({
    "liepin-src/ui-panel.js"() {
      init_constants();
      init_logger();
      init_state_manager();
      init_database();
      init_intention_learner();
      init_candidate_scorer();
      UIPanel = class {
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
          if (document.getElementById("liepin-auto-panel")) return;
          this.container = this._buildPanel();
          document.body.appendChild(this.container);
          logger.info("\u63A7\u5236\u9762\u677F\u5DF2\u52A0\u8F7D");
          this.updateProgress();
          this.updateStatus(RUN_STATES.IDLE);
          this._subscribeEvents();
        }
        _buildPanel() {
          const panel = document.createElement("div");
          panel.id = "liepin-auto-panel";
          Object.assign(panel.style, {
            position: "fixed",
            top: "80px",
            right: "20px",
            width: this.panelWidth + "px",
            height: this.panelHeight + "px",
            minWidth: "280px",
            minHeight: "300px",
            backgroundColor: "#fff",
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
            zIndex: "99999",
            fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
            fontSize: "13px",
            color: "#333",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            border: "1px solid #e8e8e8",
            userSelect: "none"
          });
          const header = document.createElement("div");
          Object.assign(header.style, {
            padding: "10px 14px",
            background: "linear-gradient(135deg, #1677ff, #0958d9)",
            color: "#fff",
            fontWeight: "600",
            fontSize: "14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "move"
          });
          header.innerHTML = '<span>\u{1F50D} \u730E\u8058\u81EA\u52A8\u6C9F\u901A</span><span><button id="liepin-auto-min" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">\u2212</button><button id="liepin-auto-cls" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0 4px;">\xD7</button></span>';
          header.addEventListener("mousedown", this._onDragStart.bind(this));
          document.addEventListener("mousemove", this._onDragMove.bind(this));
          document.addEventListener("mouseup", this._onDragEnd.bind(this));
          const body = document.createElement("div");
          body.id = "liepin-auto-body";
          Object.assign(body.style, { padding: "14px", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto", flex: "1" });
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
          progressSection.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px;"><span>\u6C9F\u901A\u8FDB\u5EA6</span><span><span id="liepin-auto-progress">0/' + stateManager.getMaxPerSession() + '</span> <input id="liepin-auto-max" type="number" min="1" max="200" value="' + stateManager.getMaxPerSession() + '" style="width:42px;font-size:11px;border:1px solid #d9d9d9;border-radius:3px;padding:1px 4px;text-align:center;" title="\u6BCF\u65E5\u4E0A\u9650"></span></div>';
          const progressBg = document.createElement("div");
          Object.assign(progressBg.style, { width: "100%", height: "6px", background: "#f0f0f0", borderRadius: "3px", overflow: "hidden" });
          this.progressBar = document.createElement("div");
          Object.assign(this.progressBar.style, { width: "0%", height: "100%", background: "linear-gradient(90deg,#1677ff,#69b1ff)", borderRadius: "3px", transition: "width 0.3s" });
          progressBg.appendChild(this.progressBar);
          progressSection.appendChild(progressBg);
          const btnGroup = document.createElement("div");
          Object.assign(btnGroup.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
          btnGroup.appendChild(this._btn("\u25B6 \u5F00\u59CB", "#1677ff", () => this._eventBus?.emit(EVENTS.START)));
          btnGroup.appendChild(this._btn("\u23F8 \u6682\u505C", "#fa8c16", () => this._eventBus?.emit(EVENTS.PAUSE)));
          btnGroup.appendChild(this._btn("\u25B6 \u7EE7\u7EED", "#52c41a", () => this._eventBus?.emit(EVENTS.RESUME)));
          btnGroup.appendChild(this._btn("\u23F9 \u505C\u6B62", "#ff4d4f", () => this._eventBus?.emit(EVENTS.STOP)));
          const toggleRow = document.createElement("div");
          Object.assign(toggleRow.style, { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0" });
          toggleRow.innerHTML = '<span style="font-size:12px;">\u{1F530} Dry-run (\u6F14\u7EC3\u6A21\u5F0F)</span>';
          const toggle = document.createElement("input");
          toggle.type = "checkbox";
          toggle.checked = stateManager.isDryRun();
          toggle.addEventListener("change", () => stateManager.setDryRun(toggle.checked));
          toggleRow.appendChild(toggle);
          const speedRow = document.createElement("div");
          speedRow.innerHTML = '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span>\u64CD\u4F5C\u95F4\u9694</span><span id="liepin-auto-delay-label">' + stateManager.getMinDelay() / 1e3 + "\u2013" + stateManager.getMaxDelay() / 1e3 + "s</span></div>";
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
            const label = document.getElementById("liepin-auto-delay-label");
            if (label) label.textContent = (min / 1e3).toFixed(1) + "\u2013" + (max / 1e3).toFixed(1) + "s";
          });
          speedRow.appendChild(speedSlider);
          const dbRow = document.createElement("div");
          Object.assign(dbRow.style, { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" });
          dbRow.innerHTML = '<span id="liepin-auto-db">\u{1F4CA} \u8BB0\u5F55: \u52A0\u8F7D\u4E2D...</span><span></span>';
          const exportSpan = dbRow.querySelector("span:last-child");
          const csvBtn = this._smallBtn("CSV", "#1677ff", () => candidateDB.download("csv"));
          const jsonBtn = this._smallBtn("JSON", "#52c41a", () => candidateDB.download("json"));
          exportSpan.appendChild(csvBtn);
          exportSpan.appendChild(jsonBtn);
          this.logContainer = document.createElement("div");
          Object.assign(this.logContainer.style, {
            maxHeight: "100px",
            overflowY: "auto",
            background: "#fafafa",
            borderRadius: "6px",
            padding: "6px",
            fontSize: "11px",
            fontFamily: "monospace",
            lineHeight: "1.4",
            flex: "1"
          });
          this.logContainer.textContent = "\u7B49\u5F85\u64CD\u4F5C...";
          body.appendChild(this.statusText);
          body.appendChild(progressSection);
          body.appendChild(btnGroup);
          body.appendChild(toggleRow);
          body.appendChild(speedRow);
          const filterRow = document.createElement("div");
          Object.assign(filterRow.style, { padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: "12px" });
          const profile = loadProfile();
          const summary = getProfileSummary(profile);
          filterRow.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span>\u{1F3AF} \u7B5B\u9009\u753B\u50CF</span><span id="liepin-auto-profile-status">' + (summary ? "\u2705 " + summary.candidateCount + "\u4EBA\u753B\u50CF" : "\u26A0 \u672A\u52A0\u8F7D") + '</span></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;"><span>\u5206\u6570\u7EBF</span><span><input id="liepin-auto-min-score" type="number" min="0" max="100" value="' + getMinScore() + '" style="width:42px;font-size:11px;border:1px solid #d9d9d9;border-radius:3px;padding:1px 4px;text-align:center;" title="\u6700\u4F4E\u5206\u6570\u7EBF"> \u5206</span></div>';
          body.appendChild(filterRow);
          body.appendChild(dbRow);
          body.appendChild(this.logContainer);
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
          const maxInput = panel.querySelector("#liepin-auto-max");
          if (maxInput) {
            maxInput.addEventListener("change", () => {
              const v = parseInt(maxInput.value) || 30;
              const clamped = Math.max(1, Math.min(200, v));
              stateManager.setMaxPerSession(clamped);
              maxInput.value = clamped;
              this.updateProgress();
            });
          }
          const scoreInput = panel.querySelector("#liepin-auto-min-score");
          if (scoreInput) {
            scoreInput.addEventListener("change", () => {
              const v = parseInt(scoreInput.value) || 40;
              const clamped = Math.max(0, Math.min(100, v));
              setMinScore(clamped);
              scoreInput.value = clamped;
            });
          }
          header.querySelector("#liepin-auto-min").addEventListener("click", (e) => {
            e.stopPropagation();
            this._toggleMinimize();
          });
          header.querySelector("#liepin-auto-cls").addEventListener("click", (e) => {
            e.stopPropagation();
            this._eventBus?.emit(EVENTS.STOP);
            panel.style.display = "none";
          });
          return panel;
        }
        _btn(text, color, onClick) {
          const btn = document.createElement("button");
          btn.textContent = text;
          Object.assign(btn.style, { padding: "8px", background: color, color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "500" });
          btn.addEventListener("click", onClick);
          return btn;
        }
        _smallBtn(text, color, onClick) {
          const btn = document.createElement("button");
          btn.textContent = text;
          Object.assign(btn.style, { background: color, color: "#fff", border: "none", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px", marginLeft: "4px" });
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick();
          });
          return btn;
        }
        _toggleMinimize() {
          const body = document.getElementById("liepin-auto-body");
          if (!body) return;
          this.isMinimized = !this.isMinimized;
          body.style.display = this.isMinimized ? "none" : "";
          this.container.style.height = this.isMinimized ? "auto" : this.panelHeight + "px";
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
          this.container.style.width = this.panelWidth + "px";
          this.container.style.height = this.panelHeight + "px";
        }
        _onResizeEnd() {
          this._isResizing = false;
        }
        updateStatus(state) {
          if (!this.statusText) return;
          const s = state || stateManager.getRunState();
          const cfgs = {
            [RUN_STATES.IDLE]: { text: "\u23F3 \u5C31\u7EEA - \u7B49\u5F85\u5F00\u59CB", bg: "#f0f0f0", color: "#666" },
            [RUN_STATES.RUNNING]: { text: "\u{1F7E2} \u8FD0\u884C\u4E2D...", bg: "#f6ffed", color: "#52c41a" },
            [RUN_STATES.PAUSED]: { text: "\u{1F7E1} \u5DF2\u6682\u505C", bg: "#fffbe6", color: "#faad14" },
            [RUN_STATES.STOPPED]: { text: "\u23F9 \u5DF2\u505C\u6B62", bg: "#fff2f0", color: "#ff4d4f" }
          };
          const cfg = cfgs[s] || cfgs[RUN_STATES.IDLE];
          this.statusText.textContent = cfg.text;
          this.statusText.style.background = cfg.bg;
          this.statusText.style.color = cfg.color;
        }
        updateProgress() {
          const greeted = stateManager.getTotalGreeted();
          const total = stateManager.getMaxPerSession();
          const el = document.getElementById("liepin-auto-progress");
          if (el) el.textContent = `${greeted}/${total}`;
          if (this.progressBar) this.progressBar.style.width = `${Math.min(100, greeted / total * 100)}%`;
        }
        appendLog(entry) {
          if (!this.logContainer) return;
          const colors = { DEBUG: "#999", INFO: "#333", SUCCESS: "#52c41a", WARN: "#faad14", ERROR: "#ff4d4f", CAPTCHA: "#d4380d" };
          const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN");
          const line = document.createElement("div");
          line.style.color = colors[entry.level] || "#333";
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
          const el = document.getElementById("liepin-auto-db");
          if (el) el.textContent = `\u{1F4CA} \u603B${candidateDB.count()}\u6761 / \u4ECA\u65E5${candidateDB.todayCount()}\u6761`;
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
        destroy() {
          if (this.container) {
            this.container.remove();
            this.container = null;
          }
          document.removeEventListener("mousemove", this._onDragMove);
          document.removeEventListener("mouseup", this._onDragEnd);
        }
      };
      uiPanel = new UIPanel();
    }
  });

  // liepin-src/core.js
  var core_exports = {};
  __export(core_exports, {
    appCore: () => appCore
  });
  var EventBus, AppCore, appCore;
  var init_core = __esm({
    "liepin-src/core.js"() {
      init_constants();
      init_logger();
      init_state_manager();
      init_card_scanner();
      init_action_engine();
      init_ui_panel();
      EventBus = class {
        constructor() {
          this._listeners = {};
        }
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
            try {
              cb(data);
            } catch (err) {
              logger.error("\u4E8B\u4EF6\u9519\u8BEF [" + e + "]", err.message);
            }
          }
        }
      };
      AppCore = class {
        constructor() {
          this.eventBus = new EventBus();
          this._initialized = false;
        }
        async init() {
          if (this._initialized) return;
          logger.info("\u730E\u8058\u81EA\u52A8\u6C9F\u901A\u5DE5\u5177 v0.1.0 \u521D\u59CB\u5316...");
          stateManager.init();
          actionEngine.setEventBus(this.eventBus);
          uiPanel.mount(this.eventBus);
          this._registerEvents();
          try {
            const cards = cardScanner.scanCards();
            logger.info("\u521D\u59CB\u5316\u5B8C\u6210\uFF0C\u68C0\u6D4B\u5230 " + cards.length + " \u4F4D\u5019\u9009\u4EBA", {
              dryRun: stateManager.isDryRun(),
              delay: `${stateManager.getMinDelay() / 1e3}-${stateManager.getMaxDelay() / 1e3}s`
            });
          } catch (e) {
            logger.warn("\u521D\u59CB\u626B\u63CF\u4E0D\u5B8C\u6574", e.message);
          }
          this._initialized = true;
          logger.success("\u2705 \u5DE5\u5177\u5C31\u7EEA\uFF01");
          logger.info('\u8BF7\u70B9\u51FB"\u5F00\u59CB"\u542F\u52A8\u81EA\u52A8\u5316');
          if (stateManager.isDryRun()) {
            logger.info("\u{1F7E1} \u5F53\u524D\u4E3A Dry-run \u6A21\u5F0F\uFF0C\u4E0D\u4F1A\u771F\u5B9E\u53D1\u9001\u6D88\u606F");
          }
        }
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
            if (stateManager.getRunState() === RUN_STATES.RUNNING) actionEngine.pause();
            else logger.warn("\u5F53\u524D\u4E0D\u5728\u8FD0\u884C\u72B6\u6001");
          });
          bus.on(EVENTS.RESUME, async () => {
            if (stateManager.getRunState() === RUN_STATES.PAUSED) await actionEngine.resume();
            else logger.warn("\u5F53\u524D\u4E0D\u5728\u6682\u505C\u72B6\u6001");
          });
          bus.on(EVENTS.STOP, () => actionEngine.stop());
          bus.on(EVENTS.LIMIT_REACHED, () => logger.success("\u4F1A\u8BDD\u9650\u5236\u5DF2\u5230\u8FBE"));
          bus.on(EVENTS.STATE_CHANGED, (s) => uiPanel.updateStatus(s));
        }
        destroy() {
          actionEngine.stop();
          uiPanel.destroy();
          this._initialized = false;
          logger.info("\u5DE5\u5177\u5DF2\u5378\u8F7D");
        }
      };
      appCore = new AppCore();
    }
  });

  // liepin-src/bootstrap.js
  init_constants();
  function isRecommendPage() {
    return window.location.href.includes(PAGE_URL_PATTERN);
  }
  function isIntentionPage() {
    return window.location.href.includes(INTENTION_PAGE_PATTERN);
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
    if (!isRecommendPage() && !isIntentionPage()) return;
    await waitForPageReady();
    if (isIntentionPage()) {
      const { initIntentionLearner: initIntentionLearner2 } = await Promise.resolve().then(() => (init_intention_learner(), intention_learner_exports));
      initIntentionLearner2();
      return;
    }
    const { appCore: appCore2 } = await Promise.resolve().then(() => (init_core(), core_exports));
    appCore2.init();
  }
  main().catch((e) => {
    console.error("[Liepin-Auto] \u542F\u52A8\u5931\u8D25:", e);
  });
})();
