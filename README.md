# investment-dashboard

个人投资仪表盘：React 18 + Vite + Tailwind CSS + IndexedDB + Cloudflare Worker Proxy，支持账面盈亏与时间加权收益率（TWR）口径。

## 本地开发

```bash
npm install
npm run dev
```

## GitHub Pages 部署

已包含 `.github/workflows/deploy.yml`，推送到 `main` 后自动构建并发布 `dist`。`vite.config.js` 已设置 `base: '/investment-dashboard/'`。

## Cloudflare Worker 部署

1. 登录 Cloudflare → Workers & Pages → Create Worker
2. 粘贴 `cloudflare-worker/index.js` 内容
3. Save and Deploy
4. 复制 Worker URL，填入仪表盘「设置」→ Proxy URL

## 首次使用

1. 设置页填写 DeepSeek API Key、Exa API Key、Proxy URL
2. 持仓明细页点击「+ 添加基金」，按步骤录入基金与期初持仓
3. 点击「刷新净值」生成首次快照
4. 使用总览、再平衡、收益追踪与 AI 分析
