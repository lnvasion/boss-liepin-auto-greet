/**
 * BOSS直聘自动沟通脚本 - 构建工具
 * 将 src/ 目录下的模块打包为单个 Tampermonkey 用户脚本
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'boss-recommend-auto.user.js');

// Tampermonkey 元数据头部
const TM_HEADER = `// ==UserScript==
// @name         BOSS直聘推荐页自动沟通
// @namespace    https://github.com/boss-recommend-auto
// @version      0.1.0
// @description  在BOSS直聘推荐页面(web/chat/recommend)自动向推荐候选人发起打招呼
// @author       BOSS Auto Tools
// @match        https://www.zhipin.com/web/chat/recommend*
// @match        https://www.zhipin.com/web/chat/recommend?*
// @match        https://www.zhipin.com/web/frame/recommend*
// @match        https://www.zhipin.com/web/frame/recommend?*
// @icon         https://www.zhipin.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

`;

async function build() {
  // Ensure dist directory
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Bundle with esbuild
  const result = await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'bootstrap.js')],
    bundle: true,
    format: 'iife',
    target: ['chrome100', 'firefox100'],
    outfile: OUT_FILE,
    minify: false,
    write: true,
    legalComments: 'inline',
  });

  // Prepend Tampermonkey header
  const bundled = fs.readFileSync(OUT_FILE, 'utf-8');
  fs.writeFileSync(OUT_FILE, TM_HEADER + bundled, 'utf-8');

  console.log(`✅ Built: ${OUT_FILE}`);
  console.log(`   Size: ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
