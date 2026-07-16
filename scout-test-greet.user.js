// ==UserScript==
// @name         BOSS 测试打招呼 v1 (函数调用)
// @namespace    gh.io/boss-recommend-auto/test-greet
// @version      1.0
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/frame/recommend*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function() {
'use strict';
setTimeout(function() {
  var iframes = document.querySelectorAll('iframe');
  var doc = document, win = window;
  for (var i = 0; i < iframes.length; i++) {
    try {
      var d = iframes[i].contentDocument || iframes[i].contentWindow.document;
      var w = iframes[i].contentWindow;
      if (d && d.querySelector('.btn.btn-greet')) { doc = d; win = w; break; }
    } catch(e) {}
  }

  var btn = doc.querySelector('.btn.btn-greet');
  if (!btn) { showMsg('no btn found'); return; }

  var cardList = doc.querySelector('.card-list');
  var recommendWrap = doc.querySelector('.recommend-list-wrap') || doc.querySelector('[class*="recommend"]');
  var output = [];

  // 辅助
  function safeStringify(v, maxLen) {
    maxLen = maxLen || 2000;
    try { var s = JSON.stringify(v, null, 2); return s.length > maxLen ? s.slice(0, maxLen) + '...' : s; }
    catch(e) { return '[error]'; }
  }

  // ===== 1. 读取 MIAO_LID =====
  output.push('========== MIAO_LID ==========');
  try {
    var miaoLid = localStorage.getItem('MIAO_LID');
    output.push('MIAO_LID: ' + (miaoLid || 'NOT FOUND'));
  } catch(e) {}

  // ===== 2. 列出 pageList[0] 的 ALL keys (用于找expectId) =====
  if (cardList && cardList.__vue__ && cardList.__vue__.$props && cardList.__vue__.$props.pageList) {
    var pl = cardList.__vue__.$props.pageList;
    if (pl.length > 0) {
      var keys = Object.keys(pl[0]).sort();
      output.push('\n========== pageList[0] ALL keys (sorted) ==========');
      output.push(keys.join('\n'));

      // 搜索任何包含 expect/id/share 的key
      var idLikeKeys = keys.filter(function(k){return /id|expect|share|encrypt/i.test(k)});
      output.push('\n--- ID/expect/share related keys ---');
      for (var ik = 0; ik < idLikeKeys.length; ik++) {
        var k = idLikeKeys[ik];
        var v = pl[0][k];
        output.push(k + ': ' + (typeof v === 'object' ? safeStringify(v, 300) : String(v).slice(0, 300)));
      }
    }
  }

  // ===== 3. 分析 BehaviorSubject =====
  output.push('\n========== pageList$ / geekList$ 详细 ==========');
  if (recommendWrap && recommendWrap.__vue__) {
    var rw = recommendWrap.__vue__;

    // pageList$
    if (rw.pageList$) {
      var pls = rw.pageList$;
      output.push('pageList$ constructor: ' + (pls.constructor ? pls.constructor.name : '?'));

      // 尝试各种方式读取值
      if (typeof pls.getValue === 'function') {
        try { var gv = pls.getValue(); output.push('getValue(): ' + typeof gv + (Array.isArray(gv)?' len='+gv.length:'')); } catch(e) { output.push('getValue() error: '+e.message); }
      }
      if ('_value' in pls) {
        try { var uv = pls._value; output.push('_value: ' + typeof uv + (Array.isArray(uv)?' len='+uv.length:'')); } catch(e) {}
      }
      if ('value' in pls) {
        try { var vv = pls.value; output.push('value: ' + typeof vv + ' val=' + String(vv).slice(0,100)); } catch(e) {}
      }
      // 尝试 subscribe
      if (typeof pls.subscribe === 'function') {
        try {
          var sub = pls.subscribe(function(v) {
            output.push('subscribe result: typeof=' + typeof v + ' isArray=' + Array.isArray(v) + (Array.isArray(v)?' len='+v.length:''));
            if (Array.isArray(v) && v.length > 0) {
              output.push('subscribe[0] keys: ' + Object.keys(v[0]).slice(0, 20).join(', '));
              output.push('subscribe[0] encryptGeekId: ' + (v[0].encryptGeekId || 'N/A'));
              output.push('subscribe[0] securityId前50: ' + (v[0].securityId || '').slice(0, 50));
              output.push('subscribe[0] expectId?: ' + (v[0].expectId || v[0].expectid || v[0].expectJobId || 'NOT FOUND'));
            }
          });
          // 马上 unsubscribe 以免泄漏
          if (sub && sub.unsubscribe) sub.unsubscribe();
        } catch(e) { output.push('subscribe error: '+e.message); }
      }
    }

    // geekList$
    if (rw.geekList$) {
      var gls = rw.geekList$;
      output.push('\ngeekList$ constructor: ' + (gls.constructor ? gls.constructor.name : '?'));
      if (typeof gls.getValue === 'function') {
        try {
          var gv2 = gls.getValue();
          output.push('getValue(): ' + typeof gv2 + (Array.isArray(gv2)?' len='+gv2.length:''));
          if (Array.isArray(gv2) && gv2.length > 0) {
            output.push('geekList[0] keys: ' + Object.keys(gv2[0]).slice(0, 20).join(', '));
            output.push('geekList[0] sample: ' + safeStringify(gv2[0], 1500));
          }
        } catch(e) { output.push('error: '+e.message); }
      }
    }
  }

  // ===== 4. 网络捕获钩子 (hook iframe的fetch用于捕获测试请求) =====
  output.push('\n========== 安装网络捕获钩子 ==========');
  var capturedRequests = [];
  try {
    var OF = win.fetch;
    win.fetch = function() {
      var args = arguments;
      var url = String(args[0]?.url || args[0] || '');
      return OF.apply(win, args).then(function(r) {
        var clone = r.clone();
        clone.text().then(function(txt) {
          if (/wapi|chat|recommend|geek|friend|sayhello|startchat|boss/i.test(url)) {
            var entry = {
              url: url.slice(0, 200),
              method: args[1]?.method || 'GET',
              reqBody: String(args[1]?.body || '').slice(0, 1500),
              respBody: txt.slice(0, 1000),
              respCode: r.status
            };
            capturedRequests.push(entry);
            output.push('捕获到: ' + entry.method + ' ' + entry.url + ' status=' + entry.respCode);
            output.push('  请求体: ' + entry.reqBody);
            output.push('  响应体: ' + entry.respBody);
          }
        }).catch(function() {});
        return r;
      });
    };
    output.push('fetch钩子已安装');
  } catch(e) {
    output.push('钩子安装失败: ' + e.message);
  }

  // ===== 5. 尝试调用 setFriend =====
  // 延迟一下，等用户确认后再试
  output.push('\n========== 准备测试 ==========');
  output.push('将在5秒后尝试调用 setFriend...');
  output.push('请等待网络请求捕获结果');

  function showMsg(report) {
    var dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#fa8c16;padding:16px;border-radius:8px;z-index:9999999;font-family:Consolas,monospace;font-size:11px;max-width:900px;white-space:pre;max-height:88vh;overflow:auto;';
    dlg.innerHTML = '<b>Test Greet v1</b>\n\n' + report;
    dlg.id = 'test-greet-dlg';
    document.body.appendChild(dlg);
    return dlg;
  }

  var dlg = showMsg(output.join('\n'));

  // 5秒后尝试调用
  setTimeout(function() {
    if (!recommendWrap || !recommendWrap.__vue__) {
      dlg.innerHTML += '\n\nERROR: recommend-wrap not found';
      return;
    }
    var rw = recommendWrap.__vue__;
    var pl = cardList.__vue__.$props.pageList;
    if (!pl || pl.length === 0) {
      dlg.innerHTML += '\n\nERROR: no candidates';
      return;
    }

    var candidate = pl[0];
    var encryptGeekId = candidate.encryptGeekId;
    output.push('\n\n========== 测试调用 ==========');
    output.push('候选人: ' + candidate.geekName);
    output.push('encryptGeekId: ' + encryptGeekId);

    // 尝试 setFriend
    if (rw.setFriend && rw.setFriend.length === 1) {
      output.push('\n调用 setFriend("' + encryptGeekId + '")...');
      try {
        var result = rw.setFriend(encryptGeekId);
        output.push('setFriend 返回值: ' + (result === undefined ? 'undefined' : safeStringify(result, 500)));
        output.push('返回类型: ' + typeof result);
        if (result && typeof result.then === 'function') output.push('-> 是Promise!');
        if (result && typeof result.subscribe === 'function') output.push('-> 是Observable!');
      } catch(e) {
        output.push('setFriend ERROR: ' + e.message);
      }
    } else {
      output.push('setFriend不可用');
    }

    // 也尝试 subscribeAddFriend
    if (rw.subscribeAddFriend) {
      output.push('\n调用 subscribeAddFriend() (0参数)...');
      try {
        var result2 = rw.subscribeAddFriend();
        output.push('subscribeAddFriend 返回值: ' + (result2 === undefined ? 'undefined' : safeStringify(result2, 500)));
      } catch(e) {
        output.push('subscribeAddFriend ERROR: ' + e.message);
      }
    }

    dlg.innerHTML = '<b>Test Greet v1</b>\n\n' + output.join('\n');

    // 等2秒再报告网络捕获结果
    setTimeout(function() {
      output.push('\n\n========== 网络捕获结果 (' + capturedRequests.length + '条) ==========');
      for (var cr = 0; cr < capturedRequests.length; cr++) {
        output.push('\n--- 请求 ' + (cr+1) + ' ---');
        output.push('URL: ' + capturedRequests[cr].url);
        output.push('方法: ' + capturedRequests[cr].method);
        output.push('请求体:\n' + capturedRequests[cr].reqBody);
        output.push('响应体:\n' + capturedRequests[cr].respBody);
      }
      if (capturedRequests.length === 0) {
        output.push('没有捕获到任何相关请求！函数可能没有发网络请求，或者走了其他通道。');
      }
      dlg.innerHTML = '<b>Test Greet v1</b>\n\n' + output.join('\n') + '\n\n<b>全选复制发给我</b>';
    }, 2000);

  }, 5000);

}, 4000);
})();
