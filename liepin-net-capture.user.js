// ==UserScript==
// @name         猎聘全量捕获 v3 (WS重点)
// @namespace    gh.io/liepin-recommend-auto/capture-v3
// @version      3.0
// @match        https://lpt.liepin.com/recommend*
// @match        https://lpt.liepin.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
'use strict';

var captured = [];
var MAX = 200;  // 加大缓冲

function add(entry) {
  captured.push(entry);
  if (captured.length > MAX) captured.shift();
}

// ==== Hook XHR prototype 级别 ====
(function() {
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._lp_m = method;
    this._lp_u = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    self.addEventListener('loadend', function() {
      var resp = '';
      try { resp = self.responseText; } catch(e) {}
      add({ t: Date.now(), ch: 'XHR', m: self._lp_m||'?', u: String(self._lp_u||'').slice(0,500),
        req: String(body||'').slice(0,3000), resp: resp.slice(0,3000) });
    });
    return origSend.call(this, body);
  };
})();

// ==== Hook fetch ====
var OF = window.fetch;
window.fetch = function() {
  var a = arguments, url = String(a[0]?.url || a[0] || '');
  var result = OF.apply(this, a);
  result.then(function(r) {
    r.clone().text().then(function(t) {
      add({ t: Date.now(), ch: 'FETCH', m: a[1]?.method||'GET', u: url.slice(0,500),
        req: String(a[1]?.body||'').slice(0,3000), resp: t.slice(0,3000) });
    }).catch(function(){});
  }).catch(function(){});
  return result;
};

// ==== Hook WebSocket (prototype级别) ====
(function() {
  var OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var ws;
    if (arguments.length === 1) {
      ws = new OrigWS(url);
    } else {
      ws = new OrigWS(url, protocols);
    }
    var wsUrl = String(url||'');
    add({ t: Date.now(), ch: 'WS:OPEN', m: '', u: wsUrl.slice(0,400), req: '', resp: '' });

    // Hook send
    var origWSSend = ws.send;
    ws.send = function(data) {
      add({ t: Date.now(), ch: 'WS:SEND', m: '', u: wsUrl.slice(0,200),
        req: String(data||'').slice(0,5000), resp: '' });
      return origWSSend.call(this, data);
    };

    // Hook onmessage
    var origAddEv = ws.addEventListener;
    ws.addEventListener = function(type, listener, options) {
      if (type === 'message') {
        var wrapped = function(event) {
          add({ t: Date.now(), ch: 'WS:RECV', m: '', u: wsUrl.slice(0,200),
            req: '', resp: String(event.data||'').slice(0,5000) });
          return listener.call(this, event);
        };
        return origAddEv.call(this, type, wrapped, options);
      }
      return origAddEv.call(this, type, listener, options);
    };

    // Also hook onmessage direct assignment
    var _onmessage = null;
    Object.defineProperty(ws, 'onmessage', {
      get: function() { return _onmessage; },
      set: function(fn) {
        _onmessage = function(event) {
          add({ t: Date.now(), ch: 'WS:RECV', m: '', u: wsUrl.slice(0,200),
            req: '', resp: String(event.data||'').slice(0,5000) });
          if (fn) return fn.call(this, event);
        };
      },
      enumerable: true, configurable: true
    });

    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
})();

// ==== UI ====
window.addEventListener('load', function() {
  setTimeout(initUI, 1500);
});

function initUI() {
  var dlg = document.createElement('div');
  dlg.id = 'lp-cap';
  dlg.style.cssText = 'position:fixed;bottom:5px;right:5px;width:620px;max-height:450px;background:#0d1117;color:#c9d1d9;border-radius:8px;z-index:99999999;font:10px Consolas,monospace;box-shadow:0 4px 24px rgba(0,0,0,0.7);display:flex;flex-direction:column;border:1px solid #30363d;';

  var bar = document.createElement('div');
  bar.style.cssText = 'padding:8px 12px;background:#161b22;border-radius:8px 8px 0 0;cursor:move;display:flex;justify-content:space-between;align-items:center;user-select:none;border-bottom:1px solid #30363d;';
  bar.innerHTML = '<span style="color:#f78166;font-weight:bold;">全量捕获 XHR+FETCH+WS</span>' +
    '<span><span id="lp-cap-count" style="color:#8b949e;margin-right:8px;">0条</span>' +
    '<button id="lp-cap-ref" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:3px 8px;border-radius:4px;cursor:pointer;margin-right:4px;">刷新</button>' +
    '<button id="lp-cap-cls" style="background:#21262d;color:#f85149;border:1px solid #30363d;padding:3px 8px;border-radius:4px;cursor:pointer;">X</button></span>';
  dlg.appendChild(bar);

  var content = document.createElement('div');
  content.id = 'lp-cap-content';
  content.style.cssText = 'padding:8px;overflow:auto;max-height:390px;white-space:pre-wrap;word-break:break-all;user-select:text;cursor:text;font-size:10px;line-height:1.3;';
  dlg.appendChild(content);
  document.body.appendChild(dlg);

  function refresh() {
    if (captured.length === 0) {
      content.textContent = '等待中...请手动: 1)点击"立即沟通" 2)在弹窗中发送打招呼';
    } else {
      content.textContent = captured.map(function(c, i) {
        var time = new Date(c.t).toLocaleTimeString('zh-CN');
        var typeTag = '[' + c.ch + ']';
        if (c.ch.indexOf('WS:SEND') === 0) typeTag = '★★★ [WS:SEND] ★★★';
        if (c.ch.indexOf('WS:RECV') === 0) typeTag = '★★ [WS:RECV] ★★';
        return '──' + i + ' ' + time + ' ' + typeTag + ' ' + c.m + '\n' +
          c.u + '\n' +
          (c.req ? '>>> ' + c.req + '\n' : '') +
          (c.resp ? '<<< ' + c.resp + '\n' : '');
      }).join('\n');
    }
    document.getElementById('lp-cap-count').textContent = captured.length + '条';
  }

  refresh();
  document.getElementById('lp-cap-ref').addEventListener('click', refresh);
  document.getElementById('lp-cap-cls').addEventListener('click', function(){ dlg.remove(); });

  // 拖动
  (function() {
    var d = false, ox = 0, oy = 0;
    bar.addEventListener('mousedown', function(e) {
      if (e.target.tagName==='BUTTON') return;
      d = true; ox = e.clientX - dlg.offsetLeft; oy = e.clientY - dlg.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!d) return;
      dlg.style.left = (e.clientX - ox) + 'px';
      dlg.style.top = (e.clientY - oy) + 'px';
      dlg.style.right = 'auto'; dlg.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function(){ d = false; });
  })();

  setInterval(refresh, 1500);
}

})();
