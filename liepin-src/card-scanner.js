/**
 * card-scanner.js — 猎聘推荐卡片扫描器
 * 通过 React Fiber 提取候选人数据
 */
import { GREET_BUTTON_SELECTORS, REACT_INTERNAL_KEYS } from './constants.js';
import { logger } from './logger.js';

class CardScanner {
  constructor() {
    this.currentCards = [];
    this.seenIds = new Set();
    this._jobData = null;  // 缓存的职位数据
  }

  /**
   * 扫描页面所有候选人卡片
   */
  scanCards() {
    const doc = document;
    const cards = [];

    // 1. 找所有"立即沟通"按钮
    const chatBtns = this._findChatButtons(doc);
    logger.info('找到 ' + chatBtns.length + ' 个"立即沟通"按钮');

    // 2. 对每个按钮提取数据
    for (const btn of chatBtns) {
      const card = this._parseCard(btn);
      if (card) cards.push(card);
    }

    // 3. 缓存职位数据 (从第一个卡片或页面API响应获取)
    if (!this._jobData && cards.length > 0) {
      this._jobData = cards[0].jobData || null;
    }
    // 共享职位数据
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
        logger.debug('found: ' + card.name + ' - ' + (card.expectPosition || '').slice(0, 30));
      }
    }

    return cards;
  }

  /**
   * 找所有"立即沟通"按钮 (排除"超级聊聊")
   */
  _findChatButtons(doc) {
    const allBtns = doc.querySelectorAll('button');
    const chatBtns = [];
    for (const btn of allBtns) {
      const text = (btn.textContent || '').trim();
      const tlgId = btn.getAttribute('data-tlg-elem-id') || '';
      if (text === '立即沟通' && tlgId.indexOf('chat_btn') !== -1) {
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
      // 找 React fiber
      let fiber = null;
      for (const key of REACT_INTERNAL_KEYS) {
        if (btnElement[key]) { fiber = btnElement[key]; break; }
        // 也检查带 hash 后缀的 key
        for (const k in btnElement) {
          if (k.indexOf(key) === 0) { fiber = btnElement[k]; break; }
        }
        if (fiber) break;
      }

      if (!fiber) return null;

      // 向上遍历 fiber tree 找 data prop
      let node = fiber;
      let dataProps = null;
      let greetHandler = null;

      while (node) {
        const mp = node.memoizedProps || {};

        // 找候选人 data
        if (!dataProps && mp.data && typeof mp.data === 'object' && mp.data.enresId) {
          dataProps = mp;
        }

        // 找 onClick handler (用于降级策略)
        if (!greetHandler && typeof mp.onClick === 'function') {
          greetHandler = mp.onClick;
        }

        if (dataProps && greetHandler) break;
        node = node.return;
      }

      if (!dataProps) return null;

      const d = dataProps.data;

      // 提取基本信息
      const name = d.showName || '';
      const id = d.enresId || d.enusercId || ('card_' + Math.random().toString(36).slice(2));

      // 教育
      let education = '';
      if (d.eduExpList && d.eduExpList.length > 0) {
        const edu = d.eduExpList[0];
        education = [edu.redSchool, edu.redSpecial, edu.redDegreeName].filter(Boolean).join(' / ');
      }

      // 最近工作
      let lastWork = '';
      if (d.workExpList && d.workExpList.length > 0) {
        const w = d.workExpList[0];
        lastWork = [w.rwdCompname, w.rwdsTitle].filter(Boolean).join(' · ');
      }

      // 期望
      const expectLocation = d.jobWant?.wantDqName || '';
      const expectPosition = d.jobWant?.wantTitle || '';

      // 标签
      const labels = Array.isArray(d.label) ? d.label.filter(Boolean).slice(0, 5).join('、') : '';

      // 活跃状态
      const activeTime = d.activeStatus || d.activeTimeDesc || '';

      return {
        element: btnElement,
        id,
        name,
        title: labels,
        description: labels,

        // 基本信息
        ageDesc: d.showAge || '',
        gender: d.sexCode || '',
        workYears: d.workYearsShow || '',
        degree: d.eduLevelShow || '',
        education,
        lastWork,
        expectLocation,
        expectPosition,
        activeTime,
        cityName: d.cityName || '',

        // API 需要的参数
        enusercId: d.enusercId || '',
        enresId: d.enresId || '',
        imId: d.imId || '',
        headId: d.headId || '',

        // 职位数据
        ejobId: dataProps.jobId || dataProps.ejobId || '',
        jobKind: dataProps.jobKind || '2',
        sfrom: dataProps.sfrom || 'R_HOMEPAGE_RECMD',
        usercId: dataProps.usercId || '',

        // React handler (降级用)
        greetHandler,

        // 原始数据引用
        _rawData: d,
        _rawProps: dataProps,
      };
    } catch (e) {
      logger.debug('card parse error: ' + e.message);
      return null;
    }
  }

  /**
   * 从页面获取全局职位数据
   */
  fetchJobData() {
    try {
      // 尝试从 recommend.init API 响应中获取 (需要网络捕获)
      // 降级: 从第一个卡片的 React props 获取
      if (this._jobData) return this._jobData;

      const cards = this.currentCards;
      if (cards.length > 0) {
        return {
          ejobId: cards[0].ejobId,
          jobKind: cards[0].jobKind || '2',
        };
      }
    } catch (e) {
      logger.debug('fetchJobData error: ' + e.message);
    }
    return null;
  }

  /**
   * 尝试从网络拦截获取职位数据
   */
  _hookForJobData() {
    // Hook fetch 拦截 get-recommend-resumes 响应获取 ejobId
    const OF = window.fetch;
    window.fetch = function () {
      const args = arguments;
      const url = String(args[0]?.url || args[0] || '');
      return OF.apply(this, args).then(async (r) => {
        if (url.includes('recommend.init') || url.includes('get-recommend-resumes')) {
          const clone = r.clone();
          try {
            const json = await clone.json();
            if (json?.data?.ejobId) {
              logger.info('捕获到 ejobId: ' + json.data.ejobId);
            }
            if (json?.data?.jobs) {
              // 缓存职位列表
            }
          } catch (e) { /* ignore */ }
        }
        return r;
      });
    };
  }

  getAllCards() { return [...this.currentCards]; }
  getUnprocessedCards(isProcessed) {
    return this.currentCards.filter((c) => !isProcessed(c.id));
  }
}

export const cardScanner = new CardScanner();
