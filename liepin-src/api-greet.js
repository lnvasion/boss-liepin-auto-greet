/**
 * api-greet.js — 猎聘API打招呼模块
 *
 * API 流程 (从网络捕获分析):
 *   1. check-tochat        — 检查是否可沟通
 *   2. check-chat-privlege — 检查权限
 *   3. to-chat2            — 发起沟通 (一次性创建对话+发送招呼语)
 *   4. get-sayhi-b-v1      — 获取默认招呼语 (可选)
 */
import { cardScanner } from './card-scanner.js';
import { stateManager } from './state-manager.js';
import { logger } from './logger.js';

const BASE_URL = 'https://api-lpt.liepin.com/api';

/**
 * 从候选人卡片提取API参数
 */
function extractParams(card) {
  return {
    enusercId: card.enusercId || '',
    enresId: card.enresId || '',
    imId: card.imId || '',
    headId: card.headId || '',
    ejobId: card.ejobId || '',
    jobKind: card.jobKind || '2',
    sfrom: card.sfrom || 'R_HOMEPAGE_RECMD',
  };
}

/**
 * 步骤1: 检查是否可以沟通
 */
async function checkTochat(oppositeUserIdEncode) {
  try {
    const formBody = new URLSearchParams();
    formBody.append('oppositeUserIdEncode', oppositeUserIdEncode);

    const resp = await fetch(BASE_URL + '/com.liepin.im.b.common.check-tochat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
      credentials: 'include',
    });
    const data = await resp.json();
    return data.flag === 1;
  } catch (e) {
    logger.debug('check-tochat failed: ' + e.message);
    return true; // 乐观继续
  }
}

/**
 * 步骤2: 检查沟通权限
 */
async function checkChatPrivilege(enusercId, ejobId, jobKind) {
  try {
    const formBody = new URLSearchParams();
    formBody.append('oppositeUserId', enusercId);
    formBody.append('jobId', ejobId);
    formBody.append('jobkind', jobKind);
    formBody.append('enumLpScene', 'R_HOMEPAGE_RECMD');

    const resp = await fetch(BASE_URL + '/com.liepin.imbusiness.bpc.check-chat-privlege', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
      credentials: 'include',
    });
    const data = await resp.json();
    return {
      canChat: data?.data?.chatCheckResultCode === 'can_chat',
      costCount: data?.data?.costCount || 0,
      leftCount: data?.data?.leftCount || 0,
    };
  } catch (e) {
    logger.debug('check-chat-privlege failed: ' + e.message);
    return { canChat: true }; // 乐观继续
  }
}

/**
 * 步骤3: 发起沟通 (核心API)
 */
async function toChat2(params) {
  const ext = JSON.stringify({
    sourceCode: 'R_HOMEPAGE_RECMD_LIST',
    head_id: params.headId,
  });

  const formBody = new URLSearchParams();
  formBody.append('usercIdEncode', params.enusercId);
  formBody.append('ejobId', params.ejobId);
  formBody.append('source', params.sfrom);
  formBody.append('head_id', params.headId);
  formBody.append('ext', ext);

  const resp = await fetch(BASE_URL + '/com.liepin.im.b.chat.to-chat2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
    credentials: 'include',
  });

  const data = await resp.json();
  return { success: data.flag === 1, data };
}

/**
 * 可选: 获取招呼语文案
 */
async function getSayHiText(imId, ejobId, jobKind) {
  try {
    const formBody = new URLSearchParams();
    formBody.append('oppositeImId', imId);
    formBody.append('jobKind', jobKind);
    formBody.append('jobId', ejobId);

    const resp = await fetch(BASE_URL + '/com.liepin.rim.b.sayhi.get-sayhi-b-v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
      credentials: 'include',
    });
    const data = await resp.json();
    return data?.data || '';
  } catch (e) {
    logger.debug('get-sayhi failed: ' + e.message);
    return '';
  }
}

/**
 * 完整的打招呼流程
 */
async function sendGreetAPI(card) {
  const params = extractParams(card);

  if (!params.enusercId) {
    return { success: false, error: '缺少参数: enusercId' };
  }
  if (!params.ejobId) {
    return { success: false, error: '缺少参数: ejobId' };
  }

  logger.debug('API打招呼: enusercId=' + params.enusercId.slice(0, 15) +
    '... ejobId=' + params.ejobId + ' headId=' + (params.headId || '').slice(0, 15) + '...');

  // Step 1: Check
  const canCheck = await checkTochat(params.enusercId);

  // Step 2: Privilege
  const priv = await checkChatPrivilege(params.enusercId, params.ejobId, params.jobKind);
  if (!priv.canChat) {
    return { success: false, error: '无沟通权限: ' + JSON.stringify(priv) };
  }

  // Step 3: Send greeting
  const result = await toChat2(params);

  if (result.success) {
    // 获取实际发送的招呼语
    let greeting = stateManager.getGreetingTemplate();
    if (!greeting && params.imId) {
      greeting = await getSayHiText(params.imId, params.ejobId, params.jobKind);
    }

    logger.success('API打招呼成功: ' + card.name + ' (enusercId:' + params.enusercId.slice(0, 15) + '...)');
    return { success: true, data: result.data, greeting };
  } else {
    logger.error('to-chat2 失败: ' + JSON.stringify(result.data).slice(0, 300));
    return { success: false, error: 'to-chat2-failed' };
  }
}

/**
 * 从卡片提取完整档案信息 (用于数据库)
 */
function extractProfile(card) {
  return {
    ageDesc: card.ageDesc || '',
    gender: card.gender || '',
    workYears: card.workYears || '',
    degree: card.degree || '',
    education: card.education || '',
    lastWork: card.lastWork || '',
    expectLocation: card.expectLocation || '',
    expectPosition: card.expectPosition || '',
    activeTime: card.activeTime || '',
    cityName: card.cityName || '',
  };
}

export { sendGreetAPI, extractProfile, checkTochat, checkChatPrivilege, toChat2, getSayHiText };
