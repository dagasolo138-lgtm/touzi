# 项目状态说明

供后续 Codex 对话快速了解当前仓库状态、约定和后续规划。

## 项目概述

个人投资仪表盘，React + Vite + Tailwind + IndexedDB，部署在 GitHub Pages。

## 技术栈

- 前端：React 18, Vite, Tailwind CSS, Recharts, react-markdown, idb, Zustand
- 存储：IndexedDB（`investment-db`，版本2）
- 外部服务：Cloudflare Worker Proxy（`touzi-proxy.dagasolo138.workers.dev`），DeepSeek V4 Pro API，Exa Search API
- 部署：GitHub Actions 自动 build 后写入 `main/docs`，GitHub Pages 从 `main/docs` 读取

## 目录结构

- `src/main.jsx`：应用入口，挂载 React 应用并加载全局样式。
- `src/App.jsx`：路由配置，使用 HashRouter 适配 GitHub Pages 子路径访问。
- `src/styles.css`：全局样式、基础暗色主题、卡片/按钮/输入框/表格辅助类。
- `src/components/`：可复用 UI 组件。
  - `AllocationChart.jsx`：目标配置与实际配置的柱状图/饼图。
  - `HoldingsTable.jsx`：持仓明细表格。
  - `Layout.jsx`：桌面侧边栏与移动端底部导航布局。
  - `NavRefreshButton.jsx`：净值刷新按钮。
  - `PerformanceChart.jsx`：收益/历史表现图表。
  - `TokenUsageBar.jsx`：AI token 用量与成本展示。
  - `TransactionForm.jsx`：交易记录录入表单。
- `src/pages/`：页面级组件。
  - `Dashboard.jsx`：持仓总览、核心指标、配置图表和持仓列表。
  - `Holdings.jsx`：持仓明细与添加基金流程。
  - `FundDetail.jsx`：基金详情页，包含净值图表、均线、RSI 和交易记录。
  - `Transactions.jsx`：交易记录管理。
  - `Rebalance.jsx`：再平衡计算器。
  - `Performance.jsx`：收益追踪与历史快照。
  - `Benchmark.jsx`：基准对比页，包含归一化对比图、超额收益表和4个基准代理。
  - `Risk.jsx`：风险指标仪表盘，包含最大回撤、年化波动率、夏普比率、回撤图、滚动波动率和类别相关性矩阵。
  - `AIAnalyst.jsx`：AI 分析师对话、流式输出、Tool Calling、对话持久化。
  - `Logs.jsx`：AI 调用日志与成本统计。
  - `Settings.jsx`：API 配置、目标配置、基金管理、数据导入导出。
- `src/db/index.js`：所有 IndexedDB 读写入口，包含数据库初始化、导入导出、配置和各实体 CRUD。
- `src/services/`：外部服务和业务服务封装。
  - `analystPrompt.js`：AI 分析师系统提示词。
  - `deepseek.js`：DeepSeek V4 Pro 流式请求、Tool Calling 和成本估算。
  - `exaSearch.js`：AI 工具定义、Exa 搜索 proxy 调用、净值历史工具、持仓上下文构造。
  - `fundApi.js`：基金信息/净值相关接口封装。
  - `snapshot.js`：组合快照生成逻辑。
- `src/store/useStore.js`：Zustand 全局状态，汇总基金、交易、净值、配置和组合统计。
- `src/utils/`：通用工具函数。
  - `positionEngine.js`：全局唯一持仓、组合汇总和分类拆分计算入口。
  - `riskEngine.js`：风险指标纯函数计算，包括收益率、波动率、回撤、夏普比率、相关性和滚动波动率。
  - `calculations.js`：再平衡计算。
  - `formatters.js`：金额、百分比、日期和 ID 格式化。
- `cloudflare-worker/index.js`：Cloudflare Worker Proxy，提供基金净值与 Exa 搜索代理路由。
- `.github/workflows/deploy.yml`：GitHub Actions 部署流程，build 后复制 `dist` 到 `docs` 并推送。

## 数据模型

IndexedDB 使用数据库 `investment-db`（版本2），主要业务导入导出覆盖以下6张表：

1. `funds`：基金基础信息与分类，主键为基金代码 `code`。
2. `transactions`：交易记录，主键为 `id`，包含基金代码、日期、金额、份额、费用、备注等字段。
3. `navHistory`：净值历史，主键为 `fundCode_date` 组合 ID，并按基金代码和日期建立索引。
4. `snapshots`：组合历史快照，主键为日期 `date`。
5. `aiLogs`：AI 调用日志，记录问题摘要、thinking 模式、token 用量、估算费用和 Exa 调用次数。
6. `conversations`：AI 对话持久化，主键为 `id`，按 `updatedAt` 建立索引。

> 说明：当前数据库还包含单例配置表 `config`，用于保存目标配置、分类、Proxy URL 和默认 thinking 模式；业务数据导入导出主要围绕上述6张表。

## 已实现功能

- P0：持仓总览、持仓明细（含添加基金3步流程）、交易记录、净值刷新、数据导入导出
- P1：再平衡计算器、收益追踪、历史快照
- 基金详情页（净值图表+均线+RSI+交易记录）
- 基准对比页（归一化对比图+超额收益表+4个基准代理）
- 风险指标仪表盘
- AI分析师：DeepSeek V4 Pro + Tool Calling（Exa搜索走proxy、净值历史、持仓上下文）+ 流式输出 + thinking模式 + 对话持久化

## 目标配置

A股25% / QDII30% / 债券30% / 黄金15%

## 代码规范

- 函数式组件 + hooks
- 所有 IndexedDB 操作通过 `src/db/index.js`
- 金额用整数分存储（×100）
- 中文界面
- 不使用版本号后缀

## 待实现功能（优先级排序）

1. 时间加权收益率（TWR）计算
2. 定投计划管理
