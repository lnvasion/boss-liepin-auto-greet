/**
 * net-capture.js — 网络请求捕获（父页面 + iframe）
 */
import { logger } from './logger.js';

let _hooked = false;

function hookWindow(win, label) {
  try {
    const XHR = win.XMLHttpRequest;
    win.XMLHttpRequest = function () {
      const x = new XHR();
      let m, u;
      const oo = x.open;
      x.open = function (method, url, ...r) {
        m = method; u = url;
        return oo.apply(this, [method, url, ...r]);
      };
      const os = x.send;
      x.send = function (body) {
        x.addEventListener('loadend', () => {
          const url = String(u || '');
          if (/wapi|api|chat|recommend|geek|friend|sayhello|startchat|boss/i.test(url)) {
            let msg = '[NET ' + label + ' XHR] ' + m + ' ' + url.slice(0, 100);
            if (body) msg += '\n  >>> ' + String(body).slice(0, 1000);
            if (x.responseText) msg += '\n  <<< ' + String(x.responseText).slice(0, 1000);
            logger.info(msg);
          }
        });
        return os.call(this, body);
      };
      return x;
    };
    win.XMLHttpRequest.prototype = XHR.prototype;

    const OF = win.fetch;
    win.fetch = function (...args) {
      const url = String(args[0]?.url || args[0] || '');
      const method = args[1]?.method || 'GET';
      const body = args[1]?.body;
      return OF.apply(this, args).then(async (r) => {
        if (/wapi|api|chat|recommend|geek|friend|sayhello|startchat|boss/i.test(url)) {
          const txt = await r.clone().text().catch(() => '');
          let msg = '[NET ' + label + ' FETCH] ' + method + ' ' + url.slice(0, 100);
          if (body) msg += '\n  >>> ' + String(body).slice(0, 1000);
          if (txt) msg += '\n  <<< ' + txt.slice(0, 1000);
          logger.info(msg);
        }
        return r;
      });
    };
  } catch (e) {
    logger.debug('hookWindow ' + label + ' failed: ' + e.message);
  }
}

export function startNetCapture() {
  if (_hooked) return;
  _hooked = true;

  // 父页面
  hookWindow(window, 'MAIN');
  logger.info('网络捕获已启动 (MAIN)');

  // iframe: 等它加载后再hook
  const tryHookIframe = () => {
    const iframes = document.querySelectorAll('iframe');
    for (const f of iframes) {
      if (f.src && f.src.includes('/web/frame/recommend') && f.contentWindow) {
        try {
          hookWindow(f.contentWindow, 'IFRAME');
          logger.info('网络捕获已启动 (IFRAME)');
          return;
        } catch (e) {}
      }
    }
    // iframe还没加载好，1秒后重试
    setTimeout(tryHookIframe, 1000);
  };
  setTimeout(tryHookIframe, 2000);
}
