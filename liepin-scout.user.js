// ==UserScript==
// @name         猎聘侦查 v5
// @namespace    gh.io/liepin-recommend-auto/scout-v5
// @version      5.0
// @match        https://lpt.liepin.com/recommend*
// @match        https://lpt.liepin.com/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
'use strict';

setTimeout(function() {
  var doc = document, win = window;
  var output = [], captured = [];

  function S(v, max) {
    max = max || 2000;
    try { var s = JSON.stringify(v, null, 2); return s.length > max ? s.slice(0, max) + '...(trunc)' : s; }
    catch(e) { return '[err]'; }
  }

  // ===== Hook 网络 (修复: OS先声明) =====
  var OX = win.XMLHttpRequest;
  var OS = OX.prototype.send;  // 先保存!
  win.XMLHttpRequest = function() {
    var x = new OX(), m, u;
    var oo = x.open;
    x.open = function(mt, ul) { m = mt; u = ul; return oo.apply(this, arguments); };
    x.send = function(b) {
      x.addEventListener('loadend', function() {
        var u2 = String(u || '');
        if (/recommend|chat|greet|start|hello|friend|card|resume|shield|sayhi|communicate/i.test(u2)) {
          captured.push({ method: m, url: u2.slice(0, 300),
            req: String(b || '').slice(0, 2000), resp: String(x.responseText || '').slice(0, 2000) });
        }
      });
      return OS.call(this, b);
    };
    return x;
  };
  win.XMLHttpRequest.prototype = OX.prototype;

  var OF = win.fetch;
  win.fetch = function() {
    var args = arguments;
    var url = String(args[0]?.url || args[0] || '');
    return OF.apply(this, args).then(function(r) {
      if (/recommend|chat|greet|start|hello|friend|card|resume|shield|sayhi|communicate/i.test(url)) {
        r.clone().text().then(function(t) {
          captured.push({ method: args[1]?.method || 'GET', url: url.slice(0, 300),
            req: String(args[1]?.body || '').slice(0, 2000), resp: t.slice(0, 2000) });
        }).catch(function(){});
      }
      return r;
    });
  };

  // ===== 找"立即沟通"按钮 =====
  var allBtns = doc.querySelectorAll('button');
  var chatBtn = null;
  for (var i = 0; i < allBtns.length; i++) {
    var text = (allBtns[i].textContent || '').trim();
    var tlg = allBtns[i].getAttribute('data-tlg-elem-id') || '';
    if (text === '立即沟通' && tlg.indexOf('chat_btn') !== -1) {
      chatBtn = allBtns[i]; break;
    }
  }

  if (!chatBtn) {
    output.push('未找到"立即沟通"按钮');
    show(output); return;
  }
  output.push('找到按钮: text="' + (chatBtn.textContent||'').trim() + '"');

  // ===== 从React fiber提取handler和data =====
  var reactKey = null;
  for (var k in chatBtn) {
    if (k.indexOf('__reactInternalInstance') === 0 || k.indexOf('__reactFiber') === 0) {
      reactKey = k; break;
    }
  }
  if (!reactKey) { output.push('no react fiber'); show(output); return; }

  var fiber = chatBtn[reactKey];

  // 向上遍历: 同时找onClick handler 和 data prop
  var node = fiber, onClickFn = null, dataProps = null, dataParent = null;
  while (node) {
    var mp = node.memoizedProps || {};

    // 找onClick
    if (!onClickFn && typeof mp.onClick === 'function') {
      onClickFn = mp.onClick;
      output.push('onClick: tag=' + node.tag + ' type=' + (node.type?.name || node.type?.displayName || '?'));
    }

    // 找data (含enresId的候选人数据)
    if (!dataProps && mp.data && typeof mp.data === 'object' && mp.data.enresId) {
      dataProps = mp;
      dataParent = node;
    }

    if (onClickFn && dataProps) break;
    node = node.return;
  }

  // ===== 输出候选人数据 =====
  output.push('\n========== 候选人数据 ==========');
  if (dataProps) {
    var d = dataProps.data;
    output.push('姓名: ' + (d.name || '(未找到)'));
    output.push('年龄: ' + (d.showAge || ''));
    output.push('性别: ' + (d.sexCode || ''));
    output.push('经验: ' + (d.workYearsShow || ''));
    output.push('学历: ' + (d.eduLevelShow || ''));
    output.push('enusercId: ' + (d.enusercId || ''));
    output.push('enresId: ' + (d.enresId || ''));
    output.push('headId: ' + (dataProps.headId || ''));
    output.push('jobId: ' + (dataProps.jobId || ''));
    output.push('usercId: ' + (dataProps.usercId || ''));
    output.push('imId: ' + (dataProps.imId || ''));
    output.push('sfrom: ' + (dataProps.sfrom || ''));
    output.push('');
    output.push('data keys: ' + Object.keys(d).join(', '));
    output.push('parent props keys: ' + Object.keys(dataProps).filter(function(k){return !k.startsWith('_')&&k!=='children'}).join(', '));
  } else {
    output.push('未找到data prop');
  }

  // ===== 调用onClick =====
  output.push('\n========== 调用handler ==========');
  if (onClickFn) {
    var fakeEvent = {
      stopPropagation: function(){}, preventDefault: function(){},
      nativeEvent: { stopImmediatePropagation: function(){} },
      target: chatBtn, currentTarget: chatBtn,
      type: 'click', button: 0,
      clientX: 100, clientY: 100, pageX: 100, pageY: 100,
    };

    output.push('2秒后调用 onClick...');
    setTimeout(function() {
      try {
        var result = onClickFn(fakeEvent);
        output.push('onClick 返回: ' + (result === undefined ? 'undefined' : typeof result));
        if (result && typeof result.then === 'function') output.push('  -> Promise!');
      } catch(e) {
        output.push('onClick 异常: ' + e.message);
      }
    }, 2000);
  } else {
    output.push('未找到onClick handler');
  }

  // ===== 汇总 =====
  setTimeout(function() {
    output.push('\n========== 网络捕获 (' + captured.length + '条) ==========');
    for (var ci = 0; ci < captured.length; ci++) {
      var c = captured[ci];
      output.push('\n[' + c.method + '] ' + c.url);
      if (c.req) output.push('>>> ' + c.req);
      if (c.resp) output.push('<<< ' + c.resp);
    }
    if (captured.length === 0) output.push('无捕获。');
    show(output);
  }, 5000);

  function show(report) {
    var old = document.getElementById('lp-scout');
    if (old) old.remove();
    var dlg = document.createElement('div');
    dlg.id = 'lp-scout';
    dlg.style.cssText = 'position:fixed;top:5px;right:5px;width:440px;max-height:320px;background:#1e1e1e;color:#52c41a;border-radius:6px;z-index:9999999;font:11px Consolas,monospace;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

    // 标题栏(可拖动)
    var titleBar = document.createElement('div');
    titleBar.id = 'lp-scout-title';
    titleBar.style.cssText = 'padding:6px 10px;background:#333;border-radius:6px 6px 0 0;cursor:move;display:flex;justify-content:space-between;align-items:center;user-select:none;';
    titleBar.innerHTML = '<span style="font-weight:bold;">猎聘 v5</span><button id="lp-scout-close" style="color:#fff;background:#c00;border:none;border-radius:3px;cursor:pointer;font-size:14px;">X</button>';
    dlg.appendChild(titleBar);

    // 内容区(可选择复制)
    var content = document.createElement('div');
    content.id = 'lp-scout-content';
    content.style.cssText = 'padding:10px;max-height:270px;overflow:auto;white-space:pre-wrap;word-break:break-all;user-select:text;cursor:text;';
    content.textContent = report;
    dlg.appendChild(content);

    document.body.appendChild(dlg);

    document.getElementById('lp-scout-close').addEventListener('click', function(){ dlg.remove(); });

    // 只在标题栏拖动
    var dragging = false, offX = 0, offY = 0;
    titleBar.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      offX = e.clientX - dlg.offsetLeft;
      offY = e.clientY - dlg.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      dlg.style.left = (e.clientX - offX) + 'px';
      dlg.style.top = (e.clientY - offY) + 'px';
      dlg.style.right = 'auto';
    });
    document.addEventListener('mouseup', function(){ dragging = false; });
  }

  output.push('脚本已加载，正在分析...');
  show(output.join('\n'));

}, 3000);
})();
