/**
 * bootstrap.js — 猎聘自动沟通脚本入口
 *
 * 推荐页: 启动自动化沟通 (含筛选)
 * 意向人选页: 自动学习候选人画像
 */
import { PAGE_URL_PATTERN, INTENTION_PAGE_PATTERN } from './constants.js';

function isRecommendPage() {
  return window.location.href.includes(PAGE_URL_PATTERN);
}

function isIntentionPage() {
  return window.location.href.includes(INTENTION_PAGE_PATTERN);
}

function waitForPageReady(timeout = 10000) {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') { setTimeout(resolve, 1500); return; }
    const timer = setTimeout(resolve, timeout);
    window.addEventListener('load', () => { clearTimeout(timer); setTimeout(resolve, 1500); }, { once: true });
  });
}

async function main() {
  if (!isRecommendPage() && !isIntentionPage()) return;
  await waitForPageReady();

  if (isIntentionPage()) {
    // 意向人选页 — 自动学习模式
    const { initIntentionLearner } = await import('./intention-learner.js');
    initIntentionLearner();
    return;
  }

  // 推荐页 — 自动化模式
  const { appCore } = await import('./core.js');
  appCore.init();
}

main().catch((e) => {
  console.error('[Liepin-Auto] 启动失败:', e);
});
