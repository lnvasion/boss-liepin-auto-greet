// ==UserScript==
// @name         猎聘意向人选侦查 v5
// @namespace    gh.io/liepin-intention-scout
// @version      5.0
// @match        https://lpt.liepin.com/recommend/intentionCandidate*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
'use strict';

var win = unsafeWindow;
var captured = [];

// ===== 立即Hook =====
(function() {
  var OX = win.XMLHttpRequest || XMLHttpRequest;
  var OSs = OX.prototype.send;
  OX.prototype.send = function(b) {
    var x = this, m = x._lp_m, u = x._lp_u;
    x.addEventListener('loadend', function() {
      captured.push({ m: m, u: String(u||'').slice(0,600),
        req: String(b||'').slice(0,3000), resp: String(x.responseText||'').slice(0,5000) });
    });
    return OSs.call(this, b);
  };
  var origOpen = OX.prototype.open;
  OX.prototype.open = function(mt, ul) { this._lp_m=mt; this._lp_u=ul; return origOpen.apply(this, arguments); };
})();

(function() {
  if (!win.fetch) return;
  var OF = win.fetch;
  win.fetch = function() {
    var a = arguments, url = String(a[0]?.url || a[0] || '');
    return OF.apply(this, a).then(function(r) {
      r.clone().text().then(function(t) {
        captured.push({ m: a[1]?.method||'GET', u: url.slice(0,600),
          req: String(a[1]?.body||'').slice(0,3000), resp: t.slice(0,5000) });
      }).catch(function(){});
      return r;
    });
  };
})();

// ===== 等DOM加载 =====
win.addEventListener('load', function() {
  setTimeout(analyze, 2500);
});

function analyze() {
  var doc = win.document;
  var output = [];

  // ===== 找查看简历按钮并点击 =====
  output.push('========== 点击查看简历 ==========');
  var allBtns = doc.querySelectorAll('button');
  var viewBtns = [];
  for (var i = 0; i < allBtns.length; i++) {
    if ((allBtns[i].textContent||'').trim() === '查看简历') {
      viewBtns.push(allBtns[i]);
    }
  }
  output.push('找到 ' + viewBtns.length + ' 个"查看简历"按钮');

  // 点第二个 (第一个可能是标题栏里的)
  var viewBtn = viewBtns.length > 1 ? viewBtns[1] : (viewBtns[0] || null);

  if (viewBtn) {
    output.push('点击第' + (viewBtns.length > 1 ? '2' : '1') + '个按钮...');
    setTimeout(function() {
      // Sys the React handler via fiber
      var clicked = false;
      for (var key in viewBtn) {
        if (key.indexOf('__reactInternalInstance') === 0 || key.indexOf('__reactFiber') === 0) {
          var fiber = viewBtn[key];
          var node = fiber;
          while (node) {
            if (node.memoizedProps && typeof node.memoizedProps.onClick === 'function') {
              try {
                node.memoizedProps.onClick({ stopPropagation:function(){}, preventDefault:function(){}, nativeEvent:{ stopImmediatePropagation:function(){} }, target:viewBtn, currentTarget:viewBtn, type:'click', button:0 });
                clicked = true;
              } catch(e) {}
              break;
            }
            node = node.return;
          }
          break;
        }
      }
      if (!clicked) viewBtn.click();

      // 等3秒汇总
      setTimeout(showResults, 3000);
    }, 2000);
  } else {
    output.push('未找到"查看简历"按钮');
    setTimeout(showResults, 1000);
  }

  function showResults() {
    output.push('\n========== 网络捕获 (' + captured.length + '条) ==========');

    // 先显示全部URL概览
    output.push('\n--- 全部请求URL ---');
    for (var ai = 0; ai < captured.length; ai++) {
      output.push(ai + '. [' + captured[ai].m + '] ' + captured[ai].u.slice(0, 150));
    }

    // 只显示相关请求
    var relevant = captured.filter(function(c) {
      return /resume|detail|cv|contact|phone|intention|getResume|viewCv|candidate/i.test(c.u);
    });

    if (relevant.length === 0) {
      // 显示全部(可能简历API的URL不匹配)
      output.push('相关请求: 0, 显示全部:');
      for (var i = 0; i < Math.min(60, captured.length); i++) {
        var c = captured[i];
        var hasPhone = /1[3-9]\d{2}\d{4}\d{4}/.test(c.resp);
        output.push('\n[' + c.m + ']' + (hasPhone ? ' 📱' : '') + ' ' + c.u);
        if (hasPhone) {
          output.push('  *** 手机号: ' + c.resp.match(/1[3-9]\d{2}\d{4}\d{4}/g).join(', '));
        }
        if (c.req) output.push('>>> ' + c.req.slice(0, 500));
        if (!hasPhone) output.push('<<< ' + c.resp.slice(0, 500));
      }
    } else {
      for (var ri = 0; ri < relevant.length; ri++) {
        var rc = relevant[ri];
        output.push('\n[' + rc.m + '] ' + rc.u);
        if (rc.req) output.push('>>> ' + rc.req.slice(0, 1000));
        output.push('<<< ' + rc.resp.slice(0, 3000));
        // 搜手机号
        var phones2 = rc.resp.match(/1[3-9]\d{9}/g);
        if (phones2) output.push('  📱 手机号: ' + phones2.join(', '));
      }
    }

    // 检查页面是否有弹窗/侧边栏出现
    output.push('\n========== 页面新元素 ==========');
    var modals = doc.querySelectorAll('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="drawer"], [class*="Drawer"], [class*="slide"], [class*="Slide"], [class*="panel"], [class*="Panel"]');
    output.push('弹窗/抽屉数: ' + modals.length);
    for (var m = 0; m < Math.min(5, modals.length); m++) {
      var modal = modals[m];
      if (modal.offsetHeight > 50) {
        var modalText = (modal.textContent||'').trim().slice(0, 400);
        var modalPhones = modalText.match(/1[3-9]\d{9}/g);
        output.push('\n元素' + m + ' (class="' + (modal.className||'').toString().slice(0,60) + '" h=' + modal.offsetHeight + ')');
        output.push('文本: ' + modalText);
        if (modalPhones) output.push(' 📱: ' + modalPhones.join(', '));
      }
    }

    show(output.join('\n'));
  }

  function show(report) {
    var old = win.document.getElementById('lp-int-scout');
    if (old) old.remove();
    var dlg = win.document.createElement('div');
    dlg.id = 'lp-int-scout';
    dlg.style.cssText = 'position:fixed;top:5px;right:5px;width:520px;max-height:420px;overflow:auto;background:#1e1e1e;color:#52c41a;padding:10px;border-radius:6px;z-index:9999999;font:10px Consolas,monospace;white-space:pre-wrap;word-break:break-all;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
    var titleBar = win.document.createElement('div');
    titleBar.style.cssText = 'padding:4px 0 8px;display:flex;justify-content:space-between;cursor:move;user-select:none;';
    titleBar.innerHTML = '<b>意向人选 v5</b><button style="color:#fff;background:#c00;border:none;border-radius:3px;cursor:pointer;font-size:13px;" id="lp-int-close">X</button>';
    dlg.appendChild(titleBar);
    var content = win.document.createElement('div');
    content.style.cssText = 'user-select:text;cursor:text;';
    content.textContent = report;
    dlg.appendChild(content);
    win.document.body.appendChild(dlg);
    win.document.getElementById('lp-int-close').addEventListener('click', function(){ dlg.remove(); });
  }

  // 初始显示
  var initOutput = output.join('\n');
  var dlg = win.document.createElement('div');
  dlg.id = 'lp-int-scout';
  dlg.style.cssText = 'position:fixed;top:5px;right:5px;width:520px;max-height:420px;overflow:auto;background:#1e1e1e;color:#52c41a;padding:10px;border-radius:6px;z-index:9999999;font:10px Consolas,monospace;white-space:pre-wrap;word-break:break-all;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
  dlg.innerHTML = '<div style="padding:4px 0 8px;display:flex;justify-content:space-between;cursor:move;user-select:none;"><b>意向人选 v5</b><button style="color:#fff;background:#c00;border:none;border-radius:3px;cursor:pointer;font-size:13px;" id="lp-int-close">X</button></div><div style="user-select:text;cursor:text;">' + initOutput + '</div>';
  win.document.body.appendChild(dlg);
  win.document.getElementById('lp-int-close').addEventListener('click', function(){ dlg.remove(); });
}

})();
