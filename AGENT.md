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


## 因子分数语义（必须保持一致）

- `actionPriority` 高分 = 对该类别新增资金的研究/补足优先级越高。
- 80+ = 该类别强烈值得关注（配置严重欠配 或 价格处于偏低区间）。
- 40-60 = 中性。
- 20- = 该类别暂不优先（配置已满 或 价格偏高）。

## 代码规范

- 函数式组件 + hooks
- 所有 IndexedDB 操作通过 `src/db/index.js`
- 金额用整数分存储（×100）
- 买入交易的持仓成本按净申购金额 + 手续费计入，手续费仍单独累计展示，避免盈亏中重复计费
- 中文界面
- 不使用版本号后缀

## 待实现功能（优先级排序）

1. 依赖安全升级（Vite / esbuild / Vitest）与包体拆分

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
- 后续最高优先级调整为依赖安全升级与包体拆分。

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
- 后续最高优先级调整为依赖安全升级与包体拆分。

## 更新记录 2026-06-24（因子数据链路修复）

- 修复从设置、历史数据、本地净值、真实类别权重、页面展示到 AI 上下文的因子链路。
- 增加因子信号基金手动历史同步、统一类别快照服务、DATA_GAP 测试与卖出手续费会计测试。

## 本次更新：AI 四 AI 协同研究工作流（模式二）

- AI 分析师页现在支持“单 AI”和“四 AI 协同”两种模式；单 AI 仍为默认模式，继续保留原有普通对话、联网搜索、Tool Calling、意图识别、`new_capital` / `fund_dive` / `health_check` 工作流、对话历史与因子辅助上下文。
- 四 AI 协同模式是固定编排的研究工作流，不是四个聊天窗口：用户只输入一个问题，程序先构建统一研究数据包，然后量化与组合分析师、市场与基金事实研究员并行运行，风险审查员等待前两者完成后运行，首席分析师最后整合为最终报告。
- 四个 Agent 职责与权限：
  - 量化与组合分析师：不联网，读取完整研究包，分析组合偏离、类别因子快照、价格位置分位数、回撤、趋势、RSI、波动率、数据置信度、定投与持仓暴露，只给研究优先级和观察结论。
  - 市场与基金事实研究员：可联网，读取用户问题和精简研究包，可使用 Exa 搜索与基金净值历史工具；基金研究优先基金公告、基金公司、指数提供商、交易所和监管机构，宏观研究优先央行、统计机构、监管机构和国际组织；外部资料不足时必须说明。
  - 风险审查员：默认不联网，读取完整研究包和前两个结构化报告，不得自行创造外部事实；负责识别旧净值、QDII 净值时滞、确认周期、汇率暴露、代理标的、技术指标预测化、接飞刀逻辑、来源质量和数据不足问题。
  - 首席分析师：不联网，读取用户问题、研究包和前三个报告，输出最终 Markdown 报告；不得自行新增外部事实，不得忽略风险审查员 verdict。
- 研究数据包由 `src/services/researchContext.js` 纯函数构建，数据来源为完整基金、完整交易、完整本地净值历史、定投计划、历史快照和 `buildCategoryFactorSnapshots()` 生成的真实类别因子快照；Agent 共享同一份包，不允许各自重算不同组合快照。
- 研究包只包含已计算的量化摘要、覆盖情况、最新净值日期和必要近期净值摘要；不会把 420 天完整净值数组直接塞给所有 Agent，完整原始净值历史仅在工具明确查询时提供。
- 外部事实必须包含来源标题、URL、发布日期（无发布日期标记未知）和抓取时间；无来源外部信息不得写入最终报告“已确认事实”。
- 风险审查员 verdict 约束最终报告：`insufficient_for_action` 时首席分析师只能给观察项、待补充信息和后续研究方向，不得给具体金额、比例或买卖动作；`downgrade` 时必须保留 requiredCaveats 并写明降级原因。
- 设置页新增“AI 协同模式提示词”区域，用户只能编辑四个 Agent 的角色职责 Prompt；固定运行协议在运行时追加，用于来源、数据质量、风险边界、QDII 时滞、结构化输出和禁止交易等约束，不能由用户删除。
- 协同任务会记录每个 Agent 的状态、耗时、原始报告、工具调用、来源、token 用量、总 token 用量、估算成本与风险 verdict；记录保存在 IndexedDB `analysisRuns` store 中，不保存 DeepSeek / Exa API Key 或其他密钥。
- 四 AI 协同模式成本和耗时高于单 AI：前两个 Agent 并行，但仍会额外消耗多轮 DeepSeek 调用；事实研究员按配置限制搜索次数（默认最多 6 次），搜索失败会降级为 `EXTERNAL_SEARCH_UNAVAILABLE`，不会阻断其他 Agent 和最终降级报告。
- 当前已新增 TWR 纯函数与 Performance / 研究包接入：快照充足时暴露 `performanceMethod: "twr"`，快照不足时暴露 `performanceMethod: "insufficient_for_twr"` 并继续警示不得把现金流导致的市值变化解释为投资收益或投资能力。

## 更新记录 2026-06-24（AI 四 AI 协同模式二）

- 新增协同提示词、研究数据包、协同运行引擎、`analysisRuns` 审计持久化、设置页四角色 Prompt 编辑和 AI 页模式切换/过程展开 UI。
- 新增测试覆盖研究包收益口径限制、旧配置安全合并、Prompt 默认恢复、协同调度顺序、风险约束 Prompt、搜索上限和协同降级路径。


## 本次更新：TWR 收益口径第一阶段

- 新增 `src/utils/twrEngine.js` 纯函数模块，用 snapshots 与 transactions 计算现金流序列、单期 TWR、累计 TWR 和数据不足状态。
- Performance 页面新增“累计 TWR”主指标和 TWR 曲线，同时保留账面盈亏并标记为非 TWR 成本口径。
- 研究包新增 `performance` 字段；快照充足时使用 `performanceMethod: "twr"`，快照不足时使用 `performanceMethod: "insufficient_for_twr"`。
- 新增 Vitest 测试覆盖追加本金、赎回、多期复合、现金流聚合与快照不足保护。

## 本次更新：TWR 收益口径第二阶段

- Dashboard 总览新增累计 TWR 卡片，并将原总盈亏明确改为账面盈亏。
- Benchmark 页面将“我的组合”曲线切换为 TWR 归一化曲线，用于和基准代理做收益率口径对比。
- Risk 页面总体风险指标改用 TWR 单期收益率计算波动率、夏普比率和回撤；类别相关性仍基于类别市值序列并在说明中提示现金流限制。
- TWR 测试补充零起始市值场景，确保组合从 0 建仓后能跳过无效期间并继续计算后续 TWR。

## 本次更新：TWR 收益口径第三阶段

- 新增类别级 TWR 计算入口 `calculateCategoryTwrSeries()`，按基金当前类别映射交易现金流，并使用快照中的类别市值计算类别 TWR。
- Risk 页面类别相关性改为基于类别 TWR 收益序列，不再直接用类别市值变化计算相关性。
- 计算说明补充类别 TWR 的限制：依赖基金类别映射与快照类别市值，历史基金改类会影响旧交易归类。

## 本次更新：TWR 收益口径第四阶段

- 移动端默认首页 Home 将“总盈亏”替换为“累计TWR”，与 Dashboard / Performance 的收益口径保持一致。
- 研究包新增 `categoryPerformance`，按类别暴露 TWR 摘要与序列，供 AI 协同工作流区分类别表现和类别因子状态。
- researchContext 测试补充类别 TWR 输出断言。

## 本次更新：TWR 收益口径第五阶段

- 快照生成 `generateSnapshot()` 会读取既有 snapshots 与交易记录，并在新快照上持久化 TWR 派生字段：`performanceMethod`、`twrPeriodReturn`、`twrCumulativeReturn`、`twrObservationCount`、`twrStartDate`、`twrEndDate` 和 `netExternalFlowCents`。
- 新增 `enrichSnapshotWithTwr()` 纯函数，便于测试和后续迁移旧快照。
- 新增 snapshot 测试覆盖首个快照数据不足与有历史快照时的 TWR 字段持久化。


## 本次更新：TWR 收益口径收尾与 UI 自动化

- 新交易会保存 `fundName` 和交易发生时的 `category`，类别 TWR 优先使用交易自身类别，降低基金后续改类对历史现金流归属的影响。
- 新增 `backfillSnapshotsWithTwr()` / `backfillSnapshotTwrMetadata()`，并在设置页增加“重算历史TWR”按钮，用于回填旧快照 TWR 元数据。
- 新增 Playwright Chromium UI 自动化测试与 `npm run test:e2e`，覆盖首页/收益追踪 TWR 文案和设置页历史 TWR 回填入口。
- 当前剩余主要阻碍：`npm audit` 仍提示 Vite / esbuild / Vitest 链路漏洞，修复需要破坏性升级；生产包主 chunk 仍超过 500 kB，后续需要路由级代码分割。

## 本次更新：因子类别差异化权重与定投联动

- 因子引擎新增 `factorSettings.categoryWeights`，A股、QDII、债券、黄金可分别配置“配置优先级 / 价格状态”权重，以及价格状态内部的分位数、回撤、RSI 权重；旧配置缺少该字段或只覆盖部分类别时必须深合并默认值。
- 类别因子快照会返回 `appliedWeights`，供 Factors 页面和后续上下文展示实际生效权重；未知类别回退到默认配置/价格与价格内部权重，不应抛错。
- 定投执行弹窗新增因子建议卡片，只根据当前类别 `actionPriority` 给出参考倍数和“一键按建议金额”按钮；不得自动修改计划金额，必须由用户主动点击后才填入建议金额。

## 本次更新：因子快照注入与持仓行为警示

- AI 分析师单 AI 工作流新增简洁量化因子上下文注入：自由对话首条用户消息、new_capital / fund_dive / health_check 关键步骤会读取本地配置、持仓与净值历史，并把类别因子快照作为辅助上下文提供给 LLM。
- `formatFactorContextForLLM()` 统一生成紧凑的“量化因子状态”文本；AI 必须把它理解为配置纪律与价格状态描述，不得当作涨跌预测。
- 基金详情页新增持仓行为警示横幅：当持仓亏损较深且价格仍处较高分位时提示损失厌恶风险；当盈利较高且价格处高位时提示过度自信风险。该提示是行为金融提醒，不是买卖建议。

## 本次更新：移动端 AI 分析页与操作反馈体验

- 添加基金三步流程从第2步开始提供“← 上一步”，返回时保留已填写数据；第3步底部改为“上一步 / 取消 / 完成添加”。
- 净值批量刷新改为逐只捕获失败基金，完成后显示成功/失败数量和可展开失败明细，失败提示可手动关闭或10秒后自动消失。
- AI 分析师页面重构为 44px 顶部栏 + 最大化消息流 + 底部大输入框；AI 模式、思考深度、历史对话和批量操作收纳到左侧抽屉，更多菜单只保留新对话和清空历史。
