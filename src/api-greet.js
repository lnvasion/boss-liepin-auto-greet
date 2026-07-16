/**
 * api-greet.js — 直接API打招呼模块
 *
 * 绕过DOM点击 + 弹窗处理，直接POST /wapi/zpjob/chat/start
 * 参数从 Vue 组件 $props.pageList 中提取
 *
 * API参数映射:
 *   gid       = pageList[i].encryptGeekId
 *   expectId  = pageList[i].expectId
 *   jid       = pageList[i].encryptJobId
 *   lid       = pageList[i].lid
 *   securityId= pageList[i].securityId
 *   suid      = pageList[i].suid (可为空)
 */
import { cardScanner } from './card-scanner.js';
import { stateManager } from './state-manager.js';
import { candidateDB } from './database.js';
import { logger } from './logger.js';
import { EVENTS } from './constants.js';

const API_URL = '/wapi/zpjob/chat/start';

/**
 * 从 card-list Vue 组件获取 pageList 原始数据
 * @returns {Array|null} pageList 数组或 null
 */
function getPageListData() {
  try {
    const doc = cardScanner.getTargetDocument();
    if (!doc) return null;

    const cardList = doc.querySelector('.card-list');
    if (!cardList || !cardList.__vue__) return null;

    const inst = cardList.__vue__;
    // $props.pageList 包含所有候选人数据
    if (inst.$props && Array.isArray(inst.$props.pageList)) {
      return inst.$props.pageList;
    }
    return null;
  } catch (e) {
    logger.debug('getPageListData error: ' + e.message);
    return null;
  }
}

/**
 * 从 pageList 中找到匹配 card 的数据
 * 匹配策略: 按名匹配 geekName，降级为按索引匹配
 * @param {Object} card - 卡片对象 (来自 cardScanner)
 * @param {Array} pageList - 完整 pageList 数据
 * @param {number} cardIndex - 卡片在当前列表中的索引
 * @returns {Object|null} 匹配的 pageList 条目
 */
function findPageListEntry(card, pageList, cardIndex) {
  if (!pageList || pageList.length === 0) return null;

  // 策略1: 按名称精确匹配
  for (const entry of pageList) {
    if (entry.geekName === card.name) return entry;
  }

  // 策略2: 按 encryptGeekId 匹配 (如果 card 有)
  if (card.encryptGeekId) {
    for (const entry of pageList) {
      if (entry.encryptGeekId === card.encryptGeekId) return entry;
    }
  }

  // 策略3: 按索引降级
  if (cardIndex >= 0 && cardIndex < pageList.length) {
    const entry = pageList[cardIndex];
    // 校验名字的前2个字符是否匹配 (兼容HTML实体编码等差异)
    if (card.name === 'unknown' ||
        (entry.geekName && entry.geekName.slice(0, 1) === card.name.slice(0, 1))) {
      return entry;
    }
  }

  return null;
}

/**
 * 从 pageList 条目构建 API 请求参数
 * @param {Object} entry - pageList 中的候选人数据
 * @returns {Object} { gid, expectId, jid, lid, securityId, suid }
 */
function buildApiParams(entry) {
  return {
    gid: entry.encryptGeekId || '',
    expectId: String(entry.expectId || ''),
    jid: entry.encryptJobId || '',
    lid: entry.lid || '',
    securityId: entry.securityId || '',
    suid: entry.suid || '',
  };
}

/**
 * 通过API直接发送打招呼
 * @param {Object} card - 卡片对象
 * @param {number} cardIndex - 卡片在当前列表中的索引
 * @returns {Promise<{success: boolean, error?: string, data?: Object}>}
 */
async function sendGreetAPI(card, cardIndex) {
  const pageList = getPageListData();
  if (!pageList) {
    return { success: false, error: '无法获取pageList数据' };
  }

  const entry = findPageListEntry(card, pageList, cardIndex);
  if (!entry) {
    return { success: false, error: '无法匹配候选人数据' };
  }

  const params = buildApiParams(entry);

  // 验证必要参数
  if (!params.gid) {
    return { success: false, error: '缺少必要参数: gid' };
  }
  if (!params.jid) {
    return { success: false, error: '缺少必要参数: jid' };
  }
  if (!params.securityId) {
    logger.warn('缺少 securityId，可能失败');
  }

  logger.debug('API参数: gid=' + params.gid.slice(0, 15) + '... expectId=' + params.expectId +
    ' jid=' + params.jid.slice(0, 15) + '...');

  // 构建请求体 (URL-encoded form)
  const formBody = new URLSearchParams();
  formBody.append('gid', params.gid);
  formBody.append('suid', params.suid);
  formBody.append('jid', params.jid);
  formBody.append('expectId', params.expectId);
  formBody.append('lid', params.lid);
  formBody.append('greet', stateManager.getGreetingTemplate() || '');
  formBody.append('from', '');
  formBody.append('securityId', params.securityId);
  formBody.append('customGreetingGuide', '-1');

  // 使用iframe的fetch发送请求
  const targetWin = cardScanner.getTargetWindow();
  if (!targetWin || !targetWin.fetch) {
    return { success: false, error: '无法访问iframe fetch API' };
  }

  try {
    const resp = await targetWin.fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
      credentials: 'include',
    });

    const data = await resp.json();

    if (data.code === 0) {
      logger.success('API打招呼成功: ' + card.name +
        ' (geekId:' + (data.zpData?.geekId || '?') + ')');
      return { success: true, data: data.zpData, entry };
    } else {
      const errMsg = data.message || ('code=' + data.code);
      logger.error('API打招呼失败: ' + errMsg + ' raw=' + JSON.stringify(data).slice(0, 300));
      return { success: false, error: errMsg };
    }
  } catch (e) {
    logger.error('API打招呼异常: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 对一批卡片依次发送API打招呼
 * @param {Array} cards - 卡片数组
 * @param {Object} eventBus - 事件总线
 * @returns {Promise<{successCount: number, failCount: number}>}
 */
export async function batchGreetViaAPI(cards, eventBus) {
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    if (stateManager.hasReachedLimit()) break;

    logger.info('API打招呼: ' + card.name);

    const result = await sendGreetAPI(card, i);

    if (result.success) {
      stateManager.markProcessed(card.id);
      stateManager.incrementGreeted();
      stateManager.resetFailure();
      successCount++;

      candidateDB.insert({
        id: card.id,
        name: card.name,
        description: card.title,
        dryRun: stateManager.isDryRun(),
      });

      eventBus?.emit(EVENTS.CARD_PROCESSED);
      eventBus?.emit(EVENTS.DB_UPDATED);
    } else {
      stateManager.incrementFailure();
      failCount++;
    }

    // 间隔避免触发频率限制
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
  }

  return { successCount, failCount };
}

/**
 * 从 pageList entry 提取候选人基本信息
 * @param {Object} entry - pageList 条目
 * @returns {Object} 结构化基本信息
 */
function extractProfile(entry) {
  if (!entry) return {};

  // 学历
  let education = '';
  if (entry.showEdus && entry.showEdus.length > 0) {
    const edu = entry.showEdus[0];
    education = [edu.school, edu.major, edu.degreeName].filter(Boolean).join(' / ');
  }

  // 最近工作
  let lastWork = '';
  if (entry.geekLastWork) {
    lastWork = [entry.geekLastWork.company, entry.geekLastWork.positionName]
      .filter(Boolean).join(' · ');
  }

  return {
    ageDesc: entry.ageDesc || '',
    gender: entry.geekGender === 1 ? '男' : entry.geekGender === 2 ? '女' : '',
    workYears: entry.geekWorkYear || '',
    degree: entry.geekDegree || '',
    education,
    lastWork,
    expectLocation: entry.expectLocationName || '',
    expectPosition: entry.expectPositionName || '',
    activeTime: entry.activeTimeDesc || '',
  };
}

export { sendGreetAPI, getPageListData, findPageListEntry, buildApiParams, extractProfile };
