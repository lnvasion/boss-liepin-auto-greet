// ==UserScript==
// @name         BOSS直聘 Vue实例数据探测
// @namespace    https://github.com/boss-recommend-auto/vue-probe
// @version      1.0
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/frame/recommend*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
'use strict';
setTimeout(function() {
  // 找iframe
  var iframes = document.querySelectorAll('iframe');
  var doc = document;
  for (var i = 0; i < iframes.length; i++) {
    try {
      var d = iframes[i].contentDocument || iframes[i].contentWindow.document;
      if (d && d.querySelector('.btn.btn-greet')) { doc = d; break; }
    } catch(e) {}
  }

  var btn = doc.querySelector('.btn.btn-greet');
  if (!btn) return;

  // 向上找card-item
  var card = btn.closest('.card-item');
  if (!card) card = btn.closest('.candidate-card-wrap');

  var output = [];

  // 从card向上找Vue实例
  var el = card || btn;
  for (var depth = 0; depth < 8 && el; depth++) {
    var vueData = null;
    var vueKeys = [];
    for (var p of ['__vue__', '__vue_app__', '__vueParentComponent']) {
      try {
        if (el[p]) {
          var inst = el[p];
          var keys = Object.keys(inst).filter(function(k) {
            return !k.startsWith('_') && !k.startsWith('$') && k !== 'constructor';
          });
          vueKeys = vueKeys.concat(keys.slice(0, 30));

          // 尝试读取数据
          if (inst.setupState) vueKeys = vueKeys.concat(Object.keys(inst.setupState).slice(0,20));
          if (inst.props) vueKeys = vueKeys.concat(Object.keys(inst.props).slice(0,20));
          if (inst.proxy) {
            try {
              var pxKeys = Object.keys(inst.proxy).filter(function(k) {
                return !k.startsWith('_') && !k.startsWith('$');
              });
              vueKeys = vueKeys.concat(pxKeys.slice(0,20));
            } catch(e2) {}
          }
        }
      } catch(e) {}
    }
    var cls = (el.className||'').toString().slice(0,60);
    var tag = el.tagName.toLowerCase();
    output.push('L'+depth+' <'+tag+'> "'+cls+'" VueKeys=[' + vueKeys.join(', ') + ']');
    el = el.parentElement;
  }

  var report = output.join('\n');

  var dlg = document.createElement('div');
  dlg.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#fa8c16;padding:16px;border-radius:8px;z-index:9999999;font-family:Consolas,monospace;font-size:11px;max-width:750px;white-space:pre;max-height:80vh;overflow:auto;';
  dlg.innerHTML = '<b>Vue Instance Data Dump</b>\n\n' + report + '\n\n<b>复制这段文字发给我</b>';
  document.body.appendChild(dlg);
}, 3000);
})();
