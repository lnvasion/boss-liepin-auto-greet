# 招聘平台自动沟通工具

Tampermonkey 用户脚本，在 BOSS直聘 / 猎聘 推荐页面自动向候选人发起打招呼。

## 脚本列表

| 脚本 | 平台 | 路径 |
|------|------|------|
| BOSS直聘自动沟通 | zhipin.com | `dist/boss-recommend-auto.user.js` |
| 猎聘自动沟通 | lpt.liepin.com | `dist/liepin-recommend-auto.user.js` |

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 在 GitHub 上打开 `.user.js` 文件 → Raw → Tampermonkey 自动弹出安装
3. 打开对应网站的推荐页面，蓝色面板出现即成功

## 功能

- 自动扫描推荐页候选人
- API 直调打招呼（绕过页面刷新）
- 沟通记录本地存储
- CSV / JSON 导出
- 可调操作间隔和每日上限
- Dry-run 演练模式

## 使用

1. 打开推荐页面
2. **先保持 Dry-run 模式测试**
3. 确认无误后关闭 Dry-run，点击"开始"

## 开发

```bash
npm install
node build.js          # 构建BOSS脚本
node liepin-build.js    # 构建猎聘脚本
```

## 目录

```
src/              BOSS直聘源码 (Vue 2 + iframe)
liepin-src/       猎聘源码 (React 16/17)
dist/             构建产物 (.user.js)
scout*.user.js    侦查探针脚本
build.js          BOSS构建
liepin-build.js   猎聘构建
```
