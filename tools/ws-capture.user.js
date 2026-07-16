/**
 * BOSS直聘 网络捕获 (v3 - 简化版)
 * 只拦截 fetch + XHR，确保面板可见
 */

// ==UserScript==
// @name         BOSS直聘 网络捕获 v3
// @namespace    https://github.com/boss-recommend-auto/net-capture
// @version      3.0
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/frame/recommend*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  const CAPTURED = [];

  function addEntry(entry) {
    CAPTURED.push(entry);
    if (CAPTURED.length > 50) CAPTURED.shift();
    updateUI();
  }

  // ==== XHR ====
  const OX = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const x = new OX(); let m, u;
    const oo = x.open; const os = x.send;
    x.open = function(method, url, ...r) { m = method; u = url; return oo.apply(this, [method, url, ...r]); };
    x.send = function(body) {
      x.addEventListener('loadend', () => {
        addEntry({
          t: new Date().toLocaleTimeString('zh-CN'),
          ch: 'XHR', dir: m + ' ' + String(u).slice(0,100),
          req: body ? String(body).slice(0,800) : '',
          resp: String(x.responseText||'').slice(0,800),
          sz: x.responseText?.length||0
        });
      });
      return os.call(this, body);
    };
    return x;
  };
  window.XMLHttpRequest.prototype = OX.prototype;

  // ==== fetch ====
  const OF = window.fetch;
  window.fetch = function(...args) {
    const url = String(args[0]?.url || args[0] || '');
    const method = args[1]?.method || 'GET';
    let body = args[1]?.body;

    return OF.apply(this, args).then(async r => {
      const txt = await r.clone().text().catch(()=>'');
      addEntry({
        t: new Date().toLocaleTimeString('zh-CN'),
        ch: 'FETCH', dir: method + ' ' + url.slice(0,100),
        req: body ? String(body).slice(0,800) : '',
        resp: txt.slice(0,800),
        sz: txt.length
      });
      return r;
    });
  };

  // ==== UI ====
  let panel, text, countEl;

  function updateUI() {
    if (text) {
      text.value = CAPTURED.map((e,i) =>
        `[${i}] ${e.t} ${e.ch} ${e.dir}\n` +
        (e.req ? '>>> ' + e.req + '\n' : '') +
        (e.resp ? '<<< ' + e.resp + '\n' : '')
      ).join('\n---\n');
      countEl.textContent = CAPTURED.length + ' 条';
    }
  }

  // 确保面板一定出现
  function init() {
    if (document.getElementById('net3')) return;

    // 红色标记点 - 证明脚本在运行
    const dot = document.createElement('div');
    dot.textContent = '●';
    dot.title = '捕获脚本已运行';
    Object.assign(dot.style, {
      position:'fixed', top:'5px', right:'5px', zIndex:'99999999',
      color:'red', fontSize:'24px', cursor:'pointer',
    });
    document.body.appendChild(dot);

    panel = document.createElement('div');
    panel.id = 'net3';
    Object.assign(panel.style, {
      position:'fixed', top:'40px', left:'50%', transform:'translateX(-50%)',
      width:'480px', maxHeight:'380px', zIndex:'9999999',
      background:'#1e1e1e', color:'#d4d4d4', borderRadius:'10px',
      fontFamily:'Consolas,monospace', fontSize:'11px',
      boxShadow:'0 4px 24px rgba(0,0,0,0.7)',
      display:'flex', flexDirection:'column', overflow:'hidden',
    });

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#333;border-radius:10px 10px 0 0;">'+
        '<span style="color:#fa8c16;font-weight:bold;">🔌 请求捕获</span>'+
        '<span id="net3-count" style="color:#888;font-size:11px;">等待...</span>'+
        '<div>'+
          '<button id="net3-copy" style="background:#0e639c;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;margin-right:4px;">复制</button>'+
        '</div>'+
      '</div>'+
      '<textarea id="net3-text" readonly style="flex:1;min-height:240px;background:#252526;color:#d4d4d4;border:none;padding:10px;font-family:Consolas,monospace;font-size:10px;resize:none;white-space:pre;overflow:auto;"></textarea>'+
      '<div style="padding:6px 12px;background:#333;font-size:10px;color:#888;">手动打招呼 → 点"复制"保存</div>';

    document.body.appendChild(panel);
    text = panel.querySelector('#net3-text');
    countEl = panel.querySelector('#net3-count');
    text.value = '等待请求...\n\n右上角红点 = 脚本已就绪\n手动打招呼一次后这里会显示捕获的内容';

    panel.querySelector('#net3-copy').addEventListener('click', () => {
      text.select(); document.execCommand('copy');
    });
  }

  // 等待 DOM 就绪
  (function wait() {
    if (document.body) { setTimeout(init, 500); }
    else { setTimeout(wait, 200); }
  })();

})();
