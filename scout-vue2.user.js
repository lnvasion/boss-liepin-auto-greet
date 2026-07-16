// ==UserScript==
// @name         BOSS Vue关键数据提取 v3
// @namespace    gh.io/boss-recommend-auto/vue-probe3
// @version      1.2
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/frame/recommend*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
'use strict';
setTimeout(function() {
  var iframes = document.querySelectorAll('iframe');
  var doc = document;
  for (var i = 0; i < iframes.length; i++) {
    try {
      var d = iframes[i].contentDocument || iframes[i].contentWindow.document;
      if (d && d.querySelector('.btn.btn-greet')) { doc = d; break; }
    } catch(e) {}
  }

  var btn = doc.querySelector('.btn.btn-greet');
  if (!btn) { showMsg('no btn found'); return; }

  var cardList = doc.querySelector('.card-list');
  var recommendWrap = doc.querySelector('.recommend-list-wrap') || doc.querySelector('[class*="recommend"]');
  var output = [];

  // 辅助函数
  function safeStringify(v, maxLen) {
    maxLen = maxLen || 5000;
    try {
      var s = JSON.stringify(v, null, 2);
      return s.length > maxLen ? s.slice(0, maxLen) + '\n...(truncated at ' + maxLen + ')' : s;
    } catch(e) {
      return '[error: ' + e.message + ']';
    }
  }

  // ===== 1. 从 card-list 的 $props 读取完整 pageList =====
  if (cardList && cardList.__vue__) {
    var cl = cardList.__vue__;
    output.push('========== card-list $props ==========');

    if (cl.$props && cl.$props.pageList) {
      var pl = cl.$props.pageList;
      output.push('pageList length: ' + pl.length);

      // 输出第一条完整数据
      if (pl.length > 0) {
        output.push('\n--- pageList[0] (完整) ---');
        output.push(safeStringify(pl[0], 8000));
      }
    }
  }

  // ===== 2. 从 recommend-wrap 读取 subscribeAddFriend 函数签名 =====
  if (recommendWrap && recommendWrap.__vue__) {
    var rw = recommendWrap.__vue__;
    output.push('\n\n========== subscribeAddFriend 分析 ==========');

    if (rw.subscribeAddFriend) {
      var fn = rw.subscribeAddFriend;
      output.push('typeof: ' + typeof fn);
      output.push('length (形参数量): ' + fn.length);
      output.push('name: ' + fn.name);

      // 获取函数源码前500字符
      var src = String(fn);
      output.push('source (前800字符):\n' + src.slice(0, 800));
    }

    // 检查 setFriend
    if (rw.setFriend) {
      output.push('\n--- setFriend ---');
      output.push('typeof: ' + typeof rw.setFriend);
      output.push('length: ' + rw.setFriend.length);
      output.push('source (前600):\n' + String(rw.setFriend).slice(0, 600));
    }

    // ===== 3. 读取各种 Observable 的值 =====
    output.push('\n\n========== RxJS Observables ==========');

    var observables = ['commonFields$', 'privilege$', 'feature$', 'hasInterestMark$', 'cardList$', 'pageList$', 'geekList$'];
    for (var oi = 0; oi < observables.length; oi++) {
      var oname = observables[oi];
      if (oname in rw) {
        var ov = rw[oname];
        output.push('\n' + oname + ': typeof=' + typeof ov);
        if (ov) {
          // RxJS Observable 可能有 source, _value, value
          var possibleValues = ['source', '_value', 'value', '_latestValue', 'getValue'];
          for (var pv = 0; pv < possibleValues.length; pv++) {
            var pvk = possibleValues[pv];
            if (pvk in ov) {
              var val = typeof ov[pvk] === 'function' ? ov[pvk]() : ov[pvk];
              output.push('  .' + pvk + ': ' + safeStringify(val, 1500));
            }
          }
          var okeys = Object.keys(ov).filter(function(k){return !k.startsWith('_')});
          if (okeys.length > 0) output.push('  keys: ' + okeys.join(', '));
          // 尝试 subscribe 读取当前值
          if (typeof ov.subscribe === 'function') {
            try {
              ov.subscribe(function(val) {
                output.push('  subscribe值: ' + safeStringify(val, 1500));
              });
            } catch(e) {}
          }
        }
      }
    }

    // ===== 4. currJob$ (已在 card-list 看到,再确认) =====
    if (rw.currJob$) {
      output.push('\n--- recommend-wrap currJob$ ---');
      output.push(safeStringify(rw.currJob$, 2000));
    }
  }

  // ===== 5. card-item 的 $vnode / props 深入 =====
  var cardItem = btn.closest('.card-item');
  if (cardItem && cardItem.__vue__) {
    var ci = cardItem.__vue__;
    output.push('\n\n========== card-item $vnode.componentOptions ==========');
    if (ci.$vnode && ci.$vnode.componentOptions) {
      output.push('componentOptions keys: ' + Object.keys(ci.$vnode.componentOptions).join(', '));
      if (ci.$vnode.componentOptions.propsData) {
        output.push('propsData: ' + safeStringify(ci.$vnode.componentOptions.propsData, 3000));
      }
    }
    if (ci._props) {
      output.push('\n_props: ' + safeStringify(ci._props, 3000));
    }
  }

  // ===== 6. 搜索页面全局的 lid / securityId =====
  output.push('\n\n========== 页面全局搜索 lid, securityId ==========');
  try {
    var html = doc.documentElement.innerHTML;
    var lidMatches = html.match(/lid["']?\s*[=:]\s*["']([^"']{10,})["']/gi);
    if (lidMatches) output.push('lid matches in HTML: ' + lidMatches.slice(0, 5).join(' | '));
    var secMatches = html.match(/securityId["']?\s*[=:]\s*["']([^"']{10,})["']/gi);
    if (secMatches) output.push('securityId matches in HTML: ' + secMatches.slice(0, 5).join(' | '));
  } catch(e) {}

  // 也搜 localStorage
  try {
    var lsKeys = [];
    for (var lk = 0; lk < localStorage.length; lk++) {
      var key = localStorage.key(lk);
      if (/lid|security|token|boss/i.test(key)) lsKeys.push(key);
    }
    if (lsKeys.length > 0) output.push('localStorage相关keys: ' + lsKeys.join(', '));
  } catch(e) {}

  // 也搜 sessionStorage
  try {
    var ssKeys = [];
    for (var sk = 0; sk < sessionStorage.length; sk++) {
      var key2 = sessionStorage.key(sk);
      if (/lid|security|token|boss/i.test(key2)) ssKeys.push(key2);
    }
    if (ssKeys.length > 0) output.push('sessionStorage相关keys: ' + ssKeys.join(', '));
  } catch(e) {}

  // ===== 7. iframe URL参数 =====
  var iframe = null;
  var iframes2 = document.querySelectorAll('iframe');
  for (var fi = 0; fi < iframes2.length; fi++) {
    if (iframes2[fi].src && iframes2[fi].src.includes('/web/frame/recommend')) {
      iframe = iframes2[fi]; break;
    }
  }
  if (iframe) {
    output.push('\n\n========== iframe URL ==========');
    output.push(iframe.src);
  }

  function showMsg(report) {
    var dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#fa8c16;padding:16px;border-radius:8px;z-index:9999999;font-family:Consolas,monospace;font-size:11px;max-width:880px;white-space:pre;max-height:90vh;overflow:auto;';
    dlg.innerHTML = '<b>Vue Key Data v3</b>\n\n' + report + '\n\n<b>全选复制发给我</b>';
    document.body.appendChild(dlg);
  }

  showMsg(output.join('\n'));
}, 4000);
})();
