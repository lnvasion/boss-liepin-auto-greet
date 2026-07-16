/**
 * anti-detect.js — 反检测层
 *
 * 提供拟人化的行为模拟：高斯延迟、平滑滚动、贝塞尔鼠标轨迹、
 * 验证码监听、标签页可见性处理、随机空闲行为等
 */

import {
  DELAY_MEAN, DELAY_STDEV, DELAY_MIN, DELAY_MAX,
  SCROLL_WAIT_MIN, SCROLL_WAIT_MAX,
  EVENT_DELAY_MIN, EVENT_DELAY_MAX,
  BACKOFF_MAX, IDLE_ACTION_PROBABILITY,
  CAPTCHA_SELECTORS,
  EVENTS,
} from './constants.js';
import { logger } from './logger.js';

/**
 * 高斯（正态）分布随机数生成器 (Box-Muller)
 * @param {number} mean - 均值
 * @param {number} stdev - 标准差
 * @returns {number}
 */
export function gaussianRandom(mean, stdev) {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(Math.max(u, 0.001))) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

/**
 * 拟人延迟 - 基于高斯分布，钳制在合理范围
 * @param {number} [min=DELAY_MIN]
 * @param {number} [max=DELAY_MAX]
 * @param {number} [mean=DELAY_MEAN]
 * @param {number} [stdev=DELAY_STDEV]
 * @returns {Promise<void>}
 */
export function humanDelay(min = DELAY_MIN, max = DELAY_MAX, mean = DELAY_MEAN, stdev = DELAY_STDEV) {
  const delay = Math.min(max, Math.max(min, Math.round(gaussianRandom(mean, stdev))));
  logger.debug(`延迟 ${delay}ms`, { delay, mean, stdev });
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 指数退避延迟
 * @param {number} attempt - 第几次重试 (0-based)
 * @returns {Promise<void>}
 */
export function exponentialBackoff(attempt) {
  const delay = Math.min(BACKOFF_MAX, 1000 * Math.pow(2, attempt));
  // 加 ±25% 的均匀抖动
  const jitter = delay * (0.75 + Math.random() * 0.5);
  const finalDelay = Math.round(jitter);
  logger.debug(`退避延迟 ${finalDelay}ms (attempt ${attempt + 1})`);
  return new Promise((resolve) => setTimeout(resolve, finalDelay));
}

/**
 * 拟人化平滑滚动到目标元素
 * 模拟: 停顿 → 平滑滚动 → 轻微过冲 → 停顿 → 微校正
 * @param {Element} element - 目标元素
 * @returns {Promise<void>}
 */
export async function humanScrollToElement(element, win = window) {
  if (!element) return;

  const thinkPause = SCROLL_WAIT_MIN + Math.random() * (SCROLL_WAIT_MAX - SCROLL_WAIT_MIN);
  await new Promise((r) => setTimeout(r, thinkPause));

  const rect = element.getBoundingClientRect();
  const targetScrollY = win.scrollY + rect.top - win.innerHeight * 0.3;

  win.scrollTo({ top: Math.max(0, targetScrollY), behavior: 'smooth' });
  await new Promise((r) => setTimeout(r, 500));

  if (Math.random() < 0.2) {
    const overshoot = 15 + Math.random() * 35;
    win.scrollBy({ top: overshoot, behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 150));
    win.scrollBy({ top: -overshoot, behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * 生成贝塞尔曲线路径点（用于鼠标移动轨迹模拟）
 * @param {number} x1 - 起点X
 * @param {number} y1 - 起点Y
 * @param {number} x2 - 终点X
 * @param {number} y2 - 终点Y
 * @param {number} [numPoints=25] - 轨迹点数量
 * @returns {Array<{x: number, y: number}>}
 */
export function generateMousePath(x1, y1, x2, y2, numPoints = 25) {
  const points = [];
  // 贝塞尔控制点: 加入横向偏移使轨迹弯曲
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpOffset = dist * (0.1 + Math.random() * 0.3); // 10-40% 弯曲

  const cp1x = x1 + dx * 0.25 + (Math.random() - 0.5) * cpOffset;
  const cp1y = y1 + dy * 0.25 + (Math.random() - 0.5) * cpOffset;
  const cp2x = x1 + dx * 0.75 + (Math.random() - 0.5) * cpOffset;
  const cp2y = y1 + dy * 0.75 + (Math.random() - 0.5) * cpOffset;

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    // 三次贝塞尔
    const x = Math.pow(1 - t, 3) * x1
      + 3 * Math.pow(1 - t, 2) * t * cp1x
      + 3 * (1 - t) * Math.pow(t, 2) * cp2x
      + Math.pow(t, 3) * x2;
    const y = Math.pow(1 - t, 3) * y1
      + 3 * Math.pow(1 - t, 2) * t * cp1y
      + 3 * (1 - t) * Math.pow(t, 2) * cp2y
      + Math.pow(t, 3) * y2;

    // 为每个点加 1-3px 垂直抖动
    const jitter = (Math.random() - 0.5) * 3;
    points.push({ x: Math.round(x), y: Math.round(y + jitter) });
  }

  return points;
}

/**
 * 在元素上派发完整鼠标事件链（模拟真实点击）
 * @param {Element} element - 目标元素
 * @returns {Promise<void>}
 */
export async function dispatchHumanClick(element) {
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // 模拟鼠标从随机位置移动到元素中心
  const startX = rect.left + Math.random() * rect.width;
  const startY = rect.top - 50 - Math.random() * 100;

  // 派发 pointerover / mouseover
  element.dispatchEvent(new PointerEvent('pointerover', {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy,
  }));
  element.dispatchEvent(new MouseEvent('mouseover', {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy,
  }));
  await new Promise((r) => setTimeout(r, EVENT_DELAY_MIN + Math.random() * EVENT_DELAY_MAX));

  // pointerdown / mousedown
  element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
  }));
  element.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
  }));
  await new Promise((r) => setTimeout(r, EVENT_DELAY_MIN + Math.random() * (EVENT_DELAY_MAX - EVENT_DELAY_MIN)));

  // pointerup / mouseup
  element.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
  }));
  element.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
  }));
  await new Promise((r) => setTimeout(r, Math.random() * 5));

  // click
  element.dispatchEvent(new PointerEvent('click', {
    bubbles: true, cancelable: true, composed: true,
    clientX: cx, clientY: cy, button: 0,
  }));
  element.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, composed: true,
    clientX: cx, clientY: cy, button: 0,
  }));
}

/**
 * 随机空闲行为 - 模拟人类浏览行为
 * 偶尔随机滚动、停顿、再滚回来
 */
export async function randomIdleAction() {
  if (Math.random() > IDLE_ACTION_PROBABILITY) return;

  const action = Math.floor(Math.random() * 3);
  switch (action) {
    case 0: {
      // 向下微微滚动然后回滚
      const scrollAmount = 30 + Math.random() * 80;
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      window.scrollBy({ top: -scrollAmount * (0.5 + Math.random() * 0.5), behavior: 'smooth' });
      break;
    }
    case 1: {
      // 快速滚动到底部再回顶部（浏览行为）
      const midScroll = 200 + Math.random() * 400;
      window.scrollBy({ top: midScroll, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      window.scrollBy({ top: -midScroll, behavior: 'smooth' });
      break;
    }
    case 2:
      // 什么都不做，只是停顿久一点
      logger.debug('随机空闲：暂停浏览');
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
      break;
  }
}

/**
 * 设置验证码观察器
 * @param {Function} onCaptcha - 检测到验证码时的回调
 * @param {Function} onResolved - 验证码解除时的回调
 * @returns {{ disconnect: Function }}
 */
export function setupCaptchaObserver(onCaptcha, onResolved, rootDoc = document) {
  let captchaActive = false;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const selector = CAPTCHA_SELECTORS.join(', ');
        const captchaEl = node.matches?.(selector) ? node : node.querySelector?.(selector);

        if (captchaEl && !captchaActive) {
          captchaActive = true;
          logger.captcha('检测到验证码！需要人工完成', { element: captchaEl.className });
          onCaptcha?.(captchaEl);
        }
      }

      // 检查验证码元素是否被移除
      if (captchaActive) {
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const selector = CAPTCHA_SELECTORS.join(', ');
          const captchaEl = node.matches?.(selector) ? node : node.querySelector?.(selector);
          if (captchaEl) {
            captchaActive = false;
            logger.success('验证码已解除');
            onResolved?.();
          }
        }
      }
    }
  });

  observer.observe(rootDoc.body, { childList: true, subtree: true });

  return {
    disconnect: () => observer.disconnect(),
  };
}

/**
 * 设置标签页可见性处理器
 * @param {Function} onHidden - 标签页隐藏时的回调
 * @param {Function} onVisible - 标签页可见时的回调
 * @returns {{ disconnect: Function }}
 */
export function setupVisibilityHandler(onHidden, onVisible) {
  const handler = () => {
    if (document.visibilityState === 'hidden') {
      logger.warn('标签页已切换到后台，自动暂停');
      onHidden?.();
    } else if (document.visibilityState === 'visible') {
      logger.info('标签页已回到前台');
      onVisible?.();
    }
  };

  document.addEventListener('visibilitychange', handler);

  return {
    disconnect: () => document.removeEventListener('visibilitychange', handler),
  };
}

/**
 * 等待元素出现（在指定时间内轮询）
 * @param {string} selector - CSS选择器
 * @param {number} [timeout=5000] - 超时毫秒
 * @returns {Promise<Element|null>}
 */
export function waitForElement(selector, timeout = 5000, rootDoc = document) {
  return new Promise((resolve) => {
    const el = rootDoc.querySelector(selector);
    if (el) return resolve(el);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const el = rootDoc.querySelector(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        resolve(null);
      }
    }, 200);
  });
}

export function waitForElementRemoval(selector, timeout = 10000, rootDoc = document) {
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
