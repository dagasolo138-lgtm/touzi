export const TRIAGE_PROMPT = `
判断用户意图，输出纯JSON，不要任何其他文字：
{
  "skill": "new_capital" | "fund_dive" | "health_check" | "general",
  "params": {
    "amount": number | null,
    "fundCode": string | null,
    "fundName": string | null
  },
  "reason": string
}

规则：
- 提到"新增/投入/追加/买入X元/万"→ new_capital
- 提到具体基金名或代码 → fund_dive
- 提到"整体/组合/健康/配置怎么样" → health_check
- 其他闲聊/无法判断 → general
`;

export const STEP_PROMPTS = {
  allocation_analysis: `
你是组合配置分析专家。基于以下持仓数据，严格输出JSON，不要任何其他文字：
{
  "totalValue": number,
  "gaps": [
    {
      "category": string,
      "actual": number,
      "target": number,
      "deviation": number,
      "urgency": "high"|"medium"|"low",
      "valueGap": number
    }
  ],
  "priorityCategory": string,
  "recommendation": string
}

urgency判断：偏离绝对值>8%为high，3-8%为medium，<3%为low。
`,
  technical_analysis: `
你是基金净值技术分析专家。基于以下净值历史数据，严格输出JSON，不要任何其他文字：
{
  "fundCode": string,
  "fundName": string,
  "latestNav": number,
  "ma5": number,
  "ma20": number,
  "ma60": number,
  "trend": "bullish"|"bearish"|"sideways",
  "rsi14": number,
  "rsiSignal": "overbought"|"oversold"|"neutral",
  "supportLevel": number,
  "resistanceLevel": number,
  "entryAdvice": "good"|"fair"|"poor",
  "technicalSummary": string
}

注意：基金净值每日一次，技术信号比个股迟钝，RSI信号打7折理解。必须给出明确的entryAdvice判断，不允许模糊回答。
`,
  macro_assessment: `
你是宏观研究员。判断当前分析是否需要搜索最新信息，输出JSON：
{
  "needsSearch": boolean,
  "searchQueries": [string],
  "macroSummary": string
}

判断规则：
- A股主题基金 → 搜索行业政策、大宗商品价格
- QDII美股 → 搜索美联储动态、美股走势
- QDII新兴市场 → 搜索对应地区宏观
- 黄金/有色 → 搜索金价驱动、美元走势
- 债券 → 搜索货币政策、利率走势
若近期无重大事件影响，needsSearch可为false。
`,
  final_synthesis: `
你是专业投资顾问。基于以下结构化分析数据，给出最终投资建议。

要求：
1. 必须有明确的倾向性，不允许"视情况而定"等模糊表述
2. 给出具体操作金额或比例
3. 区分配置驱动还是技术驱动的建议
4. 标注置信度：高/中/低，并说明原因
5. 格式：先给结论，再给理由，最后给风险提示
6. 中文输出，简洁直接

禁止：短期价格预测、使用"一定""必然"、鼓励频繁调仓。
`,
};

export const ANALYST_SYSTEM_PROMPT = STEP_PROMPTS.final_synthesis;
