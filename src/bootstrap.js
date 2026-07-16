/**
 * bootstrap.js — Tampermonkey 脚本入口
 *
 * 仅在 BOSS直聘推荐页面初始化，其他页面自动忽略
 */
import { appCore } from './core.js';
import { logger } from './logger.js';

/**
 * 检查当前URL是否为推荐页面（父页面或iframe）
 */
function isRecommendPage() {
  const url = window.location.href;
  return url.includes('/web/chat/recommend') || url.includes('/web/frame/recommend');
}

/**
 * 是否在iframe页面内 — iframe内不初始化UI，避免双面板
 */
function isInIframe() {
  return window.location.href.includes('/web/frame/recommend');
}

/**
 * 等待页面完全加载（包括 Vue 渲染）
 */
function waitForPageReady(timeout = 10000) {
  return new Promise((resolve) => {
    // 如果页面已经渲染完毕
    if (document.readyState === 'complete') {
      // 给 Vue 额外渲染时间
      setTimeout(resolve, 1500);
      return;
    }

    const timer = setTimeout(resolve, timeout);

    window.addEventListener('load', () => {
      clearTimeout(timer);
      // DOM 加载完成后等 Vue 渲染
      setTimeout(resolve, 1500);
    }, { once: true });
  });
}

/**
 * 主入口
 */
async function main() {
  // iframe内不初始化，避免双面板。父页面通过getTargetDocument操作iframe
  if (isInIframe()) {
    console.log('[BOSS-Auto] iframe页面，跳过初始化（由父页面控制）');
    return;
  }

  // 只在推荐页面激活
  if (!isRecommendPage()) {
    logger.debug('非推荐页面，跳过初始化');
    return;
  }

  // 等待页面就绪
  await waitForPageReady();

  // 初始化核心
  appCore.init();
}

// 启动
main().catch((e) => {
  console.error('[BOSS-Auto] 启动失败:', e);
});
