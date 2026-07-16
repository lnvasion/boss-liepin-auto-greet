/**
 * card-scanner.js — 推荐卡片发现与分析
 *
 * BOSS直聘使用 iframe 架构: 父页面是导航壳，实际内容在 iframe 内
 * 沟通按钮: <button class="btn btn-greet">打招呼</button>
 * 扫描需要在 iframe.contentDocument 上执行
 */
import {
  CARD_SELECTORS,
  GREET_BUTTON_SELECTORS,
  ALREADY_GREETED_SELECTORS,
  VUE_INSTANCE_PATHS,
  IFRAME_PAGE_PATTERN,
} from './constants.js';
import { logger } from './logger.js';

class CardScanner {
  constructor() {
    this.seenIds = new Set();
    this.currentCards = [];
    this._iframeDoc = null;
  }

  isInIframe() {
    return window.location.href.includes(IFRAME_PAGE_PATTERN);
  }

  _getIframeEl() {
    const iframes = document.querySelectorAll('iframe');
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
        logger.debug('iframe access error', e.message);
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

  waitForIframe(timeout = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const doc = this.getTargetDocument();
        if (doc && doc.readyState === 'complete') {
          const btns = doc.querySelectorAll('.btn.btn-greet');
          if (btns.length > 0) {
            logger.info('iframe ready, found ' + btns.length + ' greet buttons');
            resolve(doc);
            return;
          }
        }
        if (Date.now() - start > timeout) {
          logger.warn('iframe wait timeout');
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
      logger.warn('No target document');
      return [];
    }

    // Primary: find cards by greet buttons (most reliable)
    let cardElements = this._findCardsByGreetButtons(targetDoc);

    // Fallback: use CSS selectors
    if (cardElements.length === 0) {
      for (const selector of CARD_SELECTORS) {
        try {
          const elements = targetDoc.querySelectorAll(selector);
          if (elements.length > 0) {
            cardElements = Array.from(elements);
            logger.debug('selector ' + selector + ' matched ' + elements.length);
            break;
          }
        } catch (e) { /* skip */ }
      }
    }

    this.currentCards = cardElements
      .map((el) => this._parseCard(el))
      .filter((card) => card !== null);

    // 从Vue pageList丰富卡片数据
    this._enrichFromPageList(this.currentCards, targetDoc);

    for (const card of this.currentCards) {
      if (!this.seenIds.has(card.id)) {
        this.seenIds.add(card.id);
        logger.debug('found: ' + card.name + ' - ' + (card.title || '').slice(0, 40));
      }
    }

    return this.currentCards;
  }

  /**
   * Find card containers by greet buttons
   */
  _findCardsByGreetButtons(doc) {
    const cards = new Set();
    const greetBtns = doc.querySelectorAll('.btn.btn-greet');

    for (const btn of greetBtns) {
      let parent = btn.parentElement;
      for (let i = 0; i < 6 && parent; i++) {
        const tag = parent.tagName.toLowerCase();
        if (['li', 'div', 'section', 'article'].includes(tag) &&
            parent.offsetHeight > 80 && parent.offsetHeight < 500) {
          cards.add(parent);
          break;
        }
        parent = parent.parentElement;
      }
    }

    logger.info('found ' + cards.size + ' cards via greet buttons');
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
      // Skip promo/upgrade cards
      if (element.querySelector('.btn-job-top')) return null;
      const html = element.outerHTML || '';
      // Skip job post cards (contain salary ranges like "8-10K")
      if (/<[^>]*>\d+-\d+K\s*</.test(html) && !element.querySelector('.btn.btn-greet')) return null;

      // Must have greet button
      const greetButton = element.querySelector('.btn.btn-greet');
      if (!greetButton) return null;

      // Extract name: look for short text spans (<10 chars)
      let name = 'unknown';
      const spans = element.querySelectorAll('span');
      for (const s of spans) {
        const t = (s.textContent || '').trim();
        if (t.length >= 2 && t.length <= 8 &&
            !t.includes('沟通') && !t.includes('联系') && !t.includes('招呼') &&
            !t.includes('K') && !t.includes('-') && !t.includes('@') &&
            !t.includes('活跃') && !t.includes('在线') &&
            !t.includes('面议') && !t.includes('议') &&
            !/^\d+/.test(t) && !t.endsWith('岁')) {
          name = t;
          break;
        }
      }

      // If no matching span, try text content before first "优势" or "@"
      if (name === 'unknown') {
        const fullText = (element.textContent || '').trim();
        const parts = fullText.split(/优势|@|期望|刚刚|在线/);
        const firstPart = parts[0].trim();
        name = firstPart.slice(0, 10).replace(/\s+/g, ' ').trim() || 'unknown';
      }

      // Extract brief description (first line before "优势")
      let title = '';
      const fullText = (element.textContent || '').trim();
      const descMatch = fullText.match(/优势\s*(.+?)(?:@|$)/);
      if (descMatch) {
        title = descMatch[1].trim().slice(0, 60);
      }

      const alreadyGreeted = this._checkAlreadyGreeted(element);
      const id = this._generateId(element, name, title, '');

      return {
        element,
        id,
        name,
        title: title || '',
        description: title || '',
        company: '',
        greetButton,
        alreadyGreeted,
        vueInstance: this._findVueInstance(element),
        // 丰富字段 (后续由_enrichFromPageList填充)
        ageDesc: '',
        gender: '',
        workYears: '',
        degree: '',
        education: '',
        lastWork: '',
        expectLocation: '',
        cityName: '',
        activeTime: '',
        _pageData: null,
      };
    } catch (e) {
      logger.debug('card parse error: ' + e.message);
      return null;
    }
  }

  _checkAlreadyGreeted(cardElement) {
    for (const selector of ALREADY_GREETED_SELECTORS) {
      try {
        if (cardElement.querySelector(selector)) return true;
      } catch (e) { /* skip */ }
    }
    const greetBtn = cardElement.querySelector('.btn.btn-greet');
    if (greetBtn) {
      const text = greetBtn.textContent?.trim() || '';
      if (text.includes('已沟通') || text.includes('已联系') || text.includes('等待回复')) {
        return true;
      }
    }
    return false;
  }

  _generateId(element, name, title, company) {
    const dataId = element.getAttribute('data-id')
      || element.getAttribute('data-uid')
      || element.getAttribute('data-user-id')
      || element.getAttribute('data-encrypt-id');
    if (dataId) return dataId;
    const key = element.getAttribute('data-key') || element.getAttribute('key');
    if (key) return key;
    const str = name + '|' + title.slice(0, 20) + '|' + (element.outerHTML?.length || 0);
    return 'card_' + this._simpleHash(str);
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  _findVueInstance(element) {
    for (const path of VUE_INSTANCE_PATHS) {
      try {
        const inst = element[path];
        if (inst) return inst;
      } catch (e) { /* skip */ }
    }
    let parent = element.parentElement;
    for (let d = 0; d < 5 && parent; d++) {
      for (const path of VUE_INSTANCE_PATHS) {
        try {
          const inst = parent[path];
          if (inst) return inst;
        } catch (e) { /* skip */ }
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
      const cardList = targetDoc.querySelector('.card-list');
      if (!cardList || !cardList.__vue__) return;
      const inst = cardList.__vue__;
      const pageList = inst.$props?.pageList;
      if (!Array.isArray(pageList)) return;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        let entry = null;

        // 按名称匹配
        for (const e of pageList) {
          if (e.geekName === card.name) { entry = e; break; }
        }
        // 按索引降级
        if (!entry && i < pageList.length) {
          entry = pageList[i];
          if (entry.geekName && entry.geekName.slice(0, 1) !== card.name.slice(0, 1)) {
            entry = null;
          }
        }

        if (!entry) continue;

        card._pageData = entry;

        // 补充字段
        if (!card.ageDesc) card.ageDesc = entry.ageDesc || entry.showAge || '';
        if (!card.gender) card.gender = entry.sexCode === 1 ? '男' : entry.sexCode === 2 ? '女' : entry.sexCode || '';
        if (!card.workYears) card.workYears = entry.workYearsShow || entry.geekWorkYear || '';
        if (!card.degree) card.degree = entry.geekDegree || entry.eduLevelShow || '';

        // 教育经历
        if (!card.education) {
          const edus = entry.showEdus || entry.geekEdus || [];
          if (edus.length > 0) {
            card.education = [edus[0].school, edus[0].major, edus[0].degreeName]
              .filter(Boolean).join(' / ');
          }
        }

        // 最近工作
        if (!card.lastWork && entry.geekLastWork) {
          card.lastWork = [entry.geekLastWork.company, entry.geekLastWork.positionName]
            .filter(Boolean).join(' · ');
        }

        // 期望城市
        if (!card.expectLocation) {
          card.expectLocation = entry.expectLocationName || entry.expectLocation || '';
        }
        if (!card.cityName) card.cityName = entry.cityName || '';

        // 活跃状态
        if (!card.activeTime) card.activeTime = entry.activeTimeDesc || entry.activeStatus || '';
      }
    } catch (e) {
      logger.debug('_enrichFromPageList error: ' + e.message);
    }
  }

  getAllCards() { return [...this.currentCards]; }

  async waitForNewCards(timeout = 3000) {
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
}

export const cardScanner = new CardScanner();
