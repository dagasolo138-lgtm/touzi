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
- 定投计划管理：计划列表、新建/编辑、暂停/启用、删除、手动执行、到期计算、RSI提示和策略对比图

## 目标配置

A股25% / QDII30% / 债券30% / 黄金15%

## 代码规范

- 函数式组件 + hooks
- 所有 IndexedDB 操作通过 `src/db/index.js`
- 金额用整数分存储（×100）
- 买入交易的持仓成本按净申购金额 + 手续费计入，手续费仍单独累计展示，避免盈亏中重复计费
- 中文界面
- 不使用版本号后缀

## 待实现功能（优先级排序）

1. 时间加权收益率（TWR）计算

## 本次更新：移动端首页与导航

- `src/pages/Home.jsx` 作为新的默认首页 Hub，集中展示组合总览和8个功能入口。
- 原 `Dashboard.jsx` 保留在 `/dashboard`，底部导航精简为：首页、持仓、AI、设置4项。

## 本次更新：量化决策辅助 V1

- 新增 `src/utils/factorEngine.js` 纯函数模块，提供净值历史标准化、价格位置分位数、窗口高点回撤、趋势状态、波动率状态、数据置信度、配置优先级和类别因子快照计算。
- 新增 `src/pages/Factors.jsx` 与 `#/factors` 路由，按 A股 / QDII / 债券 / 黄金 展示类别卡片，用于解释配置纪律与价格状态。
- `config.factorSettings.categorySignalFunds` 用于配置每个类别唯一信号基金；不得把同类别多只基金净值平均成信号曲线。未配置时因子卡必须提示“请选择信号基金”。
- 量化决策辅助 V1 不是预测器，不自动交易、不自动加减仓、不自动修改定投金额；100 分始终表示“对新增资金更有吸引力”。
- “价格位置分位数”仅来自基金净值历史位置，不是估值分位数，界面和文档不得混用名称。
- AI 分析师可读取 factor snapshot / factorSettings，但必须作为“量化辅助数据”单独理解，因子评分不能代替事实核验和投资建议。
- 当前历史净值 Worker 请求上限已扩展，以支持 252 个有效交易日的观察需求；若上游数据不足，页面保持“数据不足”。
- 后续最高优先级仍是时间加权收益率（TWR）计算。

## 更新记录 2026-06-24

- 实现量化决策辅助 V1：新增 factorEngine、Factors 页面、类别信号基金配置、基金详情价格状态折叠区、定投执行弹窗价格状态提示与 AI 量化辅助上下文说明。
- 新增 Vitest 测试覆盖因子计算边界、数据不足保护、行动优先级语义、FALLING_KNIFE_RISK、信号基金缺失与不修改 DCA 数据约束。

## 本次更新：因子数据链路修复

- 新增 `src/services/factorDataService.js`，因子历史同步只处理设置中已配置的类别信号基金；同一信号基金被多个类别复用时去重请求，每只基金手动触发 `fetchNavHistory(code, 420)` 后逐条写入 IndexedDB，单只失败不会阻塞其他信号基金，不补造不足 252 个有效交易日的数据。
- 新增 `src/services/factorContext.js`，统一从完整基金、完整交易和本地完整净值历史构建组合、类别权重与类别因子快照，禁止用当前详情基金冒充类别信号基金或用 0 权重占位。
- Factors 页面改为手动同步因子历史，并展示每个信号基金本地有效历史条数、最新净值日期和逐基金失败信息；页面加载不会静默发起大批量网络请求。
- 基金详情页区分“本基金价格状态”和“所属类别因子状态”：前者只描述当前基金自己的价格位置、回撤、RSI、均线与数据质量；后者使用所属类别配置的信号基金和真实类别权重给出类别级因子状态。
- 定投执行弹窗读取所属类别真实因子快照，只在置信度、行动优先级和风险标记满足条件时提示可考虑额外战术资金；弹窗初始金额严格保持计划金额，不由因子系统自动改写金额、手续费或份额。
- AI 分析师新请求前会读取最新 config、funds、transactions、navHistory 并注入真实类别因子快照；量化辅助数据被明确标记为非预测结论、不可替代事实核验、不可触发自动交易，数据不足原因会原样暴露给 AI。
- `calcDataConfidence()` 改为基于原始净值行检测无效净值、重复日期和超过 `maxInternalGapDays` 的历史断档；默认阈值 14 天，正常周末间隔不触发 DATA_GAP，NAV_STALE 仍独立使用类别最新净值滞后阈值。
- `positionEngine` 卖出已实现收益纳入卖出手续费：已实现收益 = 卖出总金额 - 卖出手续费 - 对应成本；买入手续费仍进入成本且独立累计展示。
- 后续最高优先级仍是时间加权收益率（TWR）计算。

## 更新记录 2026-06-24（因子数据链路修复）

- 修复从设置、历史数据、本地净值、真实类别权重、页面展示到 AI 上下文的因子链路。
- 增加因子信号基金手动历史同步、统一类别快照服务、DATA_GAP 测试与卖出手续费会计测试。
