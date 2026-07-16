/**
 * 猎聘自动沟通脚本 - 构建工具
 * 将 liepin-src/ 打包为单个 Tampermonkey 用户脚本
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'liepin-src');
const OUT_FILE = path.join(__dirname, 'dist', 'liepin-recommend-auto.user.js');

const TM_HEADER = `// ==UserScript==
// @name         猎聘推荐页自动沟通
// @namespace    https://github.com/liepin-recommend-auto
// @version      0.1.0
// @description  在猎聘推荐页面(lpt.liepin.com/recommend)自动向推荐候选人发起沟通
// @author       Auto Tools
// @match        https://lpt.liepin.com/recommend*
// @match        https://lpt.liepin.com/recommend?*
// @icon         https://lpt.liepin.com/favicon.ico
// @grant        unsafeWindow
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

`;

async function build() {
  if (!fs.existsSync(path.join(__dirname, 'dist'))) {
    fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  }

  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'bootstrap.js')],
    bundle: true,
    format: 'iife',
    target: ['chrome100', 'firefox100'],
    outfile: OUT_FILE,
    minify: false,
    write: true,
    legalComments: 'inline',
  });

  const bundled = fs.readFileSync(OUT_FILE, 'utf-8');
  fs.writeFileSync(OUT_FILE, TM_HEADER + bundled, 'utf-8');

  console.log(`✅ Built: ${OUT_FILE}`);
  console.log(`   Size: ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
