/**
 * BOSS直聘推荐页 — 侦察脚本 v3
 *
 * v3改进:
 * - 检测标签页可见性（后台标签页Vue不渲染内容）
 * - 扫描所有可交互元素（button/a/可点击div/span）
 * - 检测iframe
 * - 报告输出到页面弹窗（BOSS页面会清除console）
 */

// ==UserScript==
// @name         BOSS直聘 - Phase 0 侦察脚本 v3
// @namespace    https://github.com/boss-recommend-auto/scout
// @version      3.0
// @description  分析BOSS直聘推荐页DOM结构（v3: 扫描所有交互元素+标签页检测）
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/frame/recommend*
// @match        https://www.zhipin.com/web/frame/recommend?*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const REPORT = [];

  function log(title, text) {
    console.log(`[Scout] ${title}`, text || '');
    REPORT.push({ title, text: String(text || '') });
  }

  function section(title) {
    const s = `\n=== ${title} ===`;
    console.log('%c' + s, 'font-weight:bold;color:#4ec9b0;');
    REPORT.push({ title: s, text: '' });
  }

  // ====================================================================
  // 等待应用渲染
  // ====================================================================
  function waitForAppReady(maxWait = 20000) {
    return new Promise((resolve) => {
      const start = Date.now();
      function check() {
        const elapsed = Date.now() - start;
        const domReady = document.readyState === 'complete';
        // 不再只检查button，也检查a标签和包含"沟通"文字的元素
        const allEls = document.querySelectorAll('*');
        let hasContent = false;
        for (const el of allEls) {
          const text = (el.textContent || '').trim();
          if (text.includes('沟通') || text.includes('立即') || text.includes('联系')) {
            hasContent = true;
            break;
          }
        }
        // 也检查"牛人" "推荐"等Boss直聘特色文字
        const bodyText = document.body?.textContent || '';
        const hasRecommend = bodyText.includes('推荐') || bodyText.includes('牛人');

        log(`轮询 ${(elapsed/1000).toFixed(1)}s`,
          `domReady:${domReady} hasContent:${hasContent} hasRecommend:${hasRecommend} visible:${document.visibilityState}`);

        if (domReady && (hasContent || hasRecommend) && document.visibilityState === 'visible') {
          log('✅ 应用就绪，等待3秒稳定...');
          setTimeout(resolve, 3000);
          return;
        }
        if (elapsed > maxWait) {
          log('⚠ 等待超时');
          resolve();
          return;
        }
        setTimeout(check, 1000);
      }
      check();
    });
  }

  // ====================================================================
  // 主流程
  // ====================================================================
  async function analyze() {
    log('🚀 BOSS直聘侦察脚本 v3');

    // 先检查标签页可见性
    section('0. 标签页状态');
    log('visibilityState', document.visibilityState);
    log('hasFocus', document.hasFocus());
    if (document.visibilityState === 'hidden') {
      log('❌ 标签页在后台！', 'Vue应用可能未渲染主内容区。请切换到BOSS直聘标签页后刷新页面重新运行！');
    }

    await waitForAppReady();

    // ================================================================
    // 1. 全局扫描
    // ================================================================
    section('1. 页面概况');
    log('URL', window.location.href);
    log('readyState', document.readyState);
    log('DOM节点总数', document.querySelectorAll('*').length);

    // iframe
    const iframes = document.querySelectorAll('iframe');
    log('iframe数量', iframes.length);
    iframes.forEach((f, i) => {
      log(`iframe[${i}]`, `src="${(f.src||'').slice(0,100)}" ${f.offsetWidth}x${f.offsetHeight}`);
    });

    // ================================================================
    // 1.5 IFRAME 内容分析 (关键!)
    // ================================================================
    section('1.5 IFRAME 内容分析');

    for (let i = 0; i < iframes.length; i++) {
      const f = iframes[i];
      if (f.offsetWidth === 0 && f.offsetHeight === 0) continue;

      let doc = null;
      try {
        doc = f.contentDocument || f.contentWindow?.document;
      } catch(e) {
        log(`iframe[${i}] 无法访问`, '可能跨域限制');
        continue;
      }

      if (!doc) {
        log(`iframe[${i}] 无法获取document`, '');
        continue;
      }

      log(`\n--- iframe[${i}] 内容分析 ---`, `URL: ${f.src}`);
      log(`  DOM节点数`, doc.querySelectorAll('*').length);
      log(`  body文本(前100)`, (doc.body?.textContent || '').trim().slice(0, 100));

      // iframe内按钮
      const iframeBtns = doc.querySelectorAll('button');
      log(`  iframe内button`, iframeBtns.length);

      if (iframeBtns.length > 0) {
        iframeBtns.forEach((b, j) => {
          const t = (b.textContent||'').trim().slice(0,30);
          const c = Array.from(b.classList).join(' ').slice(0,80);
          const r = b.getBoundingClientRect();
          log(`  iframe-btn[${j}]`, `"${t}" class="${c}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        });
      }

      // iframe内a标签
      const iframeAs = doc.querySelectorAll('a');
      log(`  iframe内a标签`, iframeAs.length);
      const iframeVisAs = [];
      iframeAs.forEach(a => {
        const r = a.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) iframeVisAs.push(a);
      });
      iframeVisAs.slice(0, 20).forEach((a, j) => {
        const t = (a.textContent||'').trim().slice(0,30).replace(/\s+/g,' ');
        const c = Array.from(a.classList).join(' ').slice(0,60);
        if (t) log(`  iframe-a[${j}]`, `"${t}" class="${c}"`);
      });

      // iframe内沟通相关元素
      const iframeEls = doc.querySelectorAll('*');
      const iframeKeywords = [];
      for (const el of iframeEls) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 30) {
          for (const kw of ['沟通', '聊', '联系', '招呼', '立即', '发送', '打招呼', '感兴趣', '有意向']) {
            if (text.includes(kw)) {
              const tag = el.tagName.toLowerCase();
              const cls = Array.from(el.classList).join(' ').slice(0,80);
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                iframeKeywords.push({ tag, text, cls, rect: { w:Math.round(rect.width), h:Math.round(rect.height), x:Math.round(rect.x), y:Math.round(rect.y) }, el });
              }
              break;
            }
          }
        }
      }
      log(`  iframe内沟通相关元素`, iframeKeywords.length);
      for (const k of iframeKeywords.slice(0, 20)) {
        log(`  [${k.tag}] "${k.text}"`, `class="${k.cls}" ${k.rect.w}x${k.rect.h} @(${k.rect.x},${k.rect.y})`);

        // Vue实例
        for (const path of ['__vue__', '__vue_app__', '__vueParentComponent']) {
          if (k.el[path]) {
            try {
              const inst = k.el[path];
              const keys = Object.keys(inst).filter(kk => !kk.startsWith('_') && !kk.startsWith('$') && kk !== 'constructor');
              log(`    Vue ${path}`, keys.slice(0,20).join(', '));
            } catch(e) {}
          }
        }

        // 父级链
        let p = k.el.parentElement;
        let chain = '';
        for (let j = 0; j < 5 && p; j++) {
          const pc = (p.className?.toString?.() || p.tagName).slice(0,60);
          const pt = p.tagName.toLowerCase();
          chain += `    L${j}: <${pt}> "${pc}"\n`;
          for (const path of ['__vue__', '__vue_app__', '__vueParentComponent']) {
            if (p[path]) {
              try {
                const keys = Object.keys(p[path]).filter(kk => !kk.startsWith('_') && !kk.startsWith('$') && kk !== 'constructor');
                chain += `      -> ${path}: ${keys.slice(0,15).join(', ')}\n`;
              } catch(e) {}
            }
          }
          p = p.parentElement;
        }
        if (chain) log(`    父级链:`, '\n' + chain);
      }

      // iframe内Vue实例
      const iframeBodyEls = doc.body?.querySelectorAll('*') || [];
      let iframeVueCount = 0;
      for (const el of iframeBodyEls) {
        for (const path of ['__vue__', '__vue_app__', '__vueParentComponent']) {
          if (el[path]) { iframeVueCount++; break; }
        }
      }
      log(`  iframe内Vue实例`, iframeVueCount);
    }

    // ================================================================
    // 2. 所有交互元素普查 (主页)
    // ================================================================
    section('2. 交互元素普查');

    const allButtons = document.querySelectorAll('button');
    const allInputs = document.querySelectorAll('input');
    const allAnchors = document.querySelectorAll('a');
    const allSpans = document.querySelectorAll('span');
    const allDivs = document.querySelectorAll('div');

    log('button', allButtons.length);
    log('input', allInputs.length);
    log('a (链接)', allAnchors.length);
    log('span', allSpans.length);
    log('div', allDivs.length);

    // ---- 所有button ----
    if (allButtons.length > 0) {
      log('--- 所有 button ---', '');
      allButtons.forEach((b, i) => {
        const t = (b.textContent||'').trim().slice(0,25);
        const c = Array.from(b.classList).join(' ').slice(0,60);
        const r = b.getBoundingClientRect();
        log(`btn[${i}]`, `"${t}" class="${c}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    } else {
      log('--- button: 0个 ---', 'BOSS直聘可能不使用<button>元素');
    }

    // ---- 所有 a 标签（可见且有文本的）----
    const visibleAs = [];
    allAnchors.forEach(a => {
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) visibleAs.push(a);
    });
    log(`可见 a 标签`, visibleAs.length);
    visibleAs.slice(0, 40).forEach((a, i) => {
      const t = (a.textContent||'').trim().slice(0,30).replace(/\s+/g,' ');
      const h = (a.getAttribute('href')||'').slice(0,80);
      const c = Array.from(a.classList).join(' ').slice(0,60);
      if (t) log(`a[${i}]`, `"${t}" href="${h}" class="${c}"`);
    });

    // ---- 包含"沟通/聊/联系/招呼/立即"文字的元素 ----
    section('3. 沟通相关元素');
    const keywords = ['沟通', '聊', '联系', '招呼', '立即', '发送', '打招呼'];
    const allElements = document.querySelectorAll('*');
    const foundKeywords = [];

    for (const el of allElements) {
      // 只检查叶子元素（没有子元素的）
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 30) {
        for (const kw of keywords) {
          if (text.includes(kw)) {
            const tag = el.tagName.toLowerCase();
            const cls = Array.from(el.classList).join(' ').slice(0,80);
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              foundKeywords.push({ tag, text, cls, rect, el });
            }
            break;
          }
        }
      }
    }

    log(`包含关键词的可见元素: ${foundKeywords.length}`, '');
    for (const f of foundKeywords.slice(0, 30)) {
      log(`[${f.tag}] "${f.text}"`, `class="${f.cls}" ${Math.round(f.rect.width)}x${Math.round(f.rect.height)} @(${Math.round(f.rect.x)},${Math.round(f.rect.y)})`);

      // Vue实例检查
      const vuePaths = ['__vue__', '__vue_app__', '__vueParentComponent', '_vnode', '__vnode'];
      for (const path of vuePaths) {
        if (f.el[path]) {
          const inst = f.el[path];
          try {
            const keys = Object.keys(inst).filter(k => !k.startsWith('_') && !k.startsWith('$') && k !== 'constructor');
            log(`  Vue: ${path}`, `keys(${keys.length}): ${keys.slice(0,20).join(', ')}`);
          } catch(e) {}
        }
      }

      // 父级链
      let p = f.el.parentElement;
      let chain = '';
      for (let j = 0; j < 4 && p; j++) {
        const pc = (p.className?.toString?.()||p.tagName).slice(0,50);
        const pt = p.tagName.toLowerCase();
        chain += `  L${j}: <${pt}> "${pc}"\n`;
        // 检查Vue实例
        for (const path of vuePaths) {
          if (p[path]) {
            try {
              const keys = Object.keys(p[path]).filter(k => !k.startsWith('_') && !k.startsWith('$') && k !== 'constructor');
              chain += `    -> ${path} keys: ${keys.slice(0,15).join(', ')}\n`;
            } catch(e) {}
          }
        }
        p = p.parentElement;
      }
      log(`  父级链:`, '\n' + chain);
    }

    // ================================================================
    // 4. 主内容区分析
    // ================================================================
    section('4. 主内容区结构');

    // 找可能的卡片区域
    const contentSelectors = [
      '[class*="recommend"]', '[class*="geek"]', '[class*="candidate"]',
      '[class*="card"]', '[class*="list-content"]', '[class*="main"]',
      '[class*="body"]', '[class*="content"]',
    ];
    for (const sel of contentSelectors) {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0 && els.length < 100) {
          const el = els[0];
          const cls = el.className?.toString?.()?.slice(0,100) || '';
          const rect = el.getBoundingClientRect();
          const childCount = el.children.length;
          const html = el.outerHTML?.slice(0,300) || '';
          log(`${sel} (${els.length}个)`, `${Math.round(rect.width)}x${Math.round(rect.height)} children:${childCount} class:"${cls}"`);
          log(`  HTML片段`, html);
        }
      } catch(e) {}
    }

    // ================================================================
    // 5. Vue DevTools 辅助
    // ================================================================
    section('5. Vue 实例探测');

    // 遍历body下所有元素找Vue实例
    const bodyChildren = document.body.querySelectorAll('*');
    let vueCount = 0;
    const vueSampleKeys = new Set();
    for (const el of bodyChildren) {
      for (const path of ['__vue__', '__vue_app__', '__vueParentComponent']) {
        if (el[path]) {
          vueCount++;
          if (vueCount <= 3) {
            try {
              const inst = el[path];
              const keys = Object.keys(inst).filter(k => !k.startsWith('_') && !k.startsWith('$') && k !== 'constructor');
              keys.forEach(k => vueSampleKeys.add(k));
              log(`Vue@<${el.tagName.toLowerCase()}> via ${path}`, `class="${el.className?.toString?.()?.slice(0,60)}" keys: ${keys.slice(0,15).join(', ')}`);
            } catch(e) {}
          }
        }
      }
    }
    log(`总Vue实例数`, vueCount);
    log(`Vue实例键名样本`, [...vueSampleKeys].slice(0, 30).join(', '));

    // ================================================================
    // 6. WebSocket
    // ================================================================
    section('6. WebSocket');
    const OrigWS = window.WebSocket;
    window.WebSocket = function(...args) {
      const ws = new OrigWS(...args);
      log('WebSocket连接', args[0]);
      const origSend = ws.send;
      ws.send = function(data) {
        const preview = data instanceof ArrayBuffer ? `Binary[${data.byteLength}]`
          : typeof data === 'string' ? data.slice(0,200)
          : String(data).slice(0,200);
        log('WS发送', preview);
        return origSend.call(this, data);
      };
      ws.addEventListener('message', e => {
        const preview = e.data instanceof ArrayBuffer ? `Binary[${e.data.byteLength}]`
          : typeof e.data === 'string' ? e.data.slice(0,200)
          : String(e.data).slice(0,200);
        log('WS接收', preview);
      });
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    log('WebSocket hook已安装', '请手动发起一次沟通以捕获消息格式');

    // ================================================================
    // 7. 存储
    // ================================================================
    section('7. 存储');
    const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(Boolean);
    log('Cookies', cookies.join(', '));

    // ================================================================
    // 8. 输出报告
    // ================================================================
    section('8. 报告完成');
    log('关键数据', `可见关键词元素:${foundKeywords.length} | Vue实例:${vueCount} | iframe:${iframes.length}`);

    showReportDialog(foundKeywords, vueCount);
  }

  function showReportDialog(foundKeywords, vueCount) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:'fixed',top:0,left:0,right:0,bottom:0,
      background:'rgba(0,0,0,0.5)',zIndex:'999998',
      display:'flex',alignItems:'center',justifyContent:'center',
    });

    const dlg = document.createElement('div');
    Object.assign(dlg.style, {
      background:'#1e1e1e',color:'#d4d4d4',borderRadius:'12px',
      padding:'20px',width:'92%',maxWidth:'750px',maxHeight:'85vh',
      fontFamily:'Consolas,monospace',fontSize:'12px',zIndex:'999999',
      boxShadow:'0 8px 32px rgba(0,0,0,0.5)',display:'flex',flexDirection:'column',
    });

    let reportText = '';
    for (const entry of REPORT) {
      if (entry.title.startsWith('\n===')) {
        reportText += `\n${entry.title}\n`;
      } else {
        reportText += `${entry.title}: ${entry.text}\n`;
      }
    }

    dlg.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="color:#4ec9b0;font-size:16px;font-weight:bold;">🔍 BOSS直聘 侦察报告 v3</span>
        <div>
          <button id="sc-copy" style="background:#0e639c;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">📋 复制全部</button>
          <button id="sc-close" style="background:#555;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">✕</button>
        </div>
      </div>
      <textarea id="sc-text" readonly style="flex:1;min-height:400px;background:#252526;color:#d4d4d4;border:1px solid #3e3e3e;border-radius:6px;padding:12px;font-family:Consolas,monospace;font-size:11px;resize:vertical;white-space:pre;overflow:auto;line-height:1.5;"></textarea>
      <div style="color:#888;font-size:11px;margin-top:8px;">找到 ${foundKeywords.length} 个沟通相关元素 | ${vueCount} 个Vue实例 | 请点"复制全部"保存</div>
    `;

    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    dlg.querySelector('#sc-text').value = reportText;
    dlg.querySelector('#sc-copy').addEventListener('click', () => {
      const ta = dlg.querySelector('#sc-text');
      ta.select(); document.execCommand('copy');
      dlg.querySelector('#sc-copy').textContent = '✅ 已复制!';
    });
    dlg.querySelector('#sc-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
  }

  analyze().catch(e => console.error('[Scout]', e));
})();

// ===== 快速脚本：打印第一个打招呼按钮的父容器所有data属性 =====
setTimeout(function() {
  var btn = document.querySelector('.btn.btn-greet');
  if (!btn) {
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var doc = iframes[i].contentDocument || iframes[i].contentWindow.document;
        btn = doc.querySelector('.btn.btn-greet');
        if (btn) break;
      } catch(e) {}
    }
  }
  if (!btn) { console.log('No greet button found'); return; }

  // 向上遍历找卡片容器
  var el = btn;
  var output = [];
  for (var depth = 0; depth < 8 && el; depth++) {
    var attrs = [];
    for (var a = 0; a < el.attributes.length; a++) {
      var attr = el.attributes[a];
      attrs.push(attr.name + '=' + attr.value.slice(0, 80));
    }
    output.push('L' + depth + ' <' + el.tagName.toLowerCase() + '> class="' + (el.className||'').slice(0,60) + '" attrs=[' + attrs.join(', ') + ']');
    el = el.parentElement;
  }

  var report = output.join('\n');
  console.log('Card DOM trace:\n' + report);

  // 页面弹窗
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#fa8c16;padding:16px;border-radius:8px;z-index:9999999;font-family:Consolas,monospace;font-size:11px;max-width:700px;white-space:pre;';
  d.innerHTML = '<b>Card DOM Trace</b>\n' + report + '\n\n复制这段文字发给我';
  document.body.appendChild(d);
}, 3000);
