/**
 * bootstrap.js — 猎聘自动沟通脚本入口
 */
import { PAGE_URL_PATTERN } from './constants.js';

function isRecommendPage() {
  return window.location.href.includes(PAGE_URL_PATTERN);
}

function waitForPageReady(timeout = 10000) {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') { setTimeout(resolve, 1500); return; }
    const timer = setTimeout(resolve, timeout);
    window.addEventListener('load', () => { clearTimeout(timer); setTimeout(resolve, 1500); }, { once: true });
  });
}

async function main() {
  if (!isRecommendPage()) return;
  await waitForPageReady();
  // 动态 import core (由 esbuild 打包)
  const { appCore } = await import('./core.js');
  appCore.init();
}

main().catch((e) => {
  console.error('[Liepin-Auto] 启动失败:', e);
});
