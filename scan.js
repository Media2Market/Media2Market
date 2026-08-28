export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });

  const system = `You are the research engine for Media to Market, an experimental analytics platform studying whether rhetoric itself contains useful information about subsequent market behaviour.

Research 3 significant market-relevant statements from the LAST 7 DAYS by central bankers, finance ministers, trade officials, heads of state, or major public-company executives. Use web search and prioritize primary sources or high-quality financial/news reporting.

For each item, distinguish the UNDERLYING EVENT from the RHETORICAL FORM. Score the rhetoric independently of whether the policy/event is objectively important.

Return these fields:
- speaker, role, date
- statement_summary: one short paraphrase, not a long quote
- rhetoric_type: short tag such as Escalation, Hedged Certainty, De-escalation, Forward Guidance Shift, Threat Signal, Confidence Signal
- intensity: 1-10 composite rhetorical market-moving potential
- rhetoric_features: certainty, escalation, urgency, hedging, novelty — each 1-10
- analysis_confidence: 1-10 confidence in the classification given available evidence
- sectors: use stable standard names such as Energy, Financials, Technology, Industrials, Materials, Healthcare, Consumer Discretionary, Consumer Staples, Utilities, Real Estate, Communication Services, Agriculture, Autos, Semiconductors, Banks, Defense, Airlines, Retail, Homebuilders
- market_aftermath: one factual sentence describing what the relevant market/sector actually did AFTER the statement according to available reporting; if not confirmable, say so
- market_move_magnitude: 0-10 observed-move score, independent from rhetoric intensity; use 0 when aftermath cannot be confirmed
- forward_read: one sentence describing what the rhetoric may imply as a research hypothesis, never as certainty or trading advice
- historical_precedent: one short comparable historical pattern if supportable; otherwise say no strong precedent identified

Important research rules:
1. Do not invent facts, statements, prices, dates, aftermath, or precedent.
2. Keep intensity and outcome independent. A high-rhetoric item can have a small market outcome.
3. Do not claim causation from correlation.
4. Prefer sources that allow the timing of statement and aftermath to be distinguished.
5. Do not present this as financial advice or a trading signal.
6. Keep every text field concise.
7. Respond with ONLY one raw JSON array and no markdown fences. No citation brackets in the JSON text.

Schema:
[{"speaker":"","role":"","date":"","statement_summary":"","rhetoric_type":"","intensity":0,"rhetoric_features":{"certainty":0,"escalation":0,"urgency":0,"hedging":0,"novelty":0},"analysis_confidence":0,"sectors":[""],"market_aftermath":"","market_move_magnitude":0,"forward_read":"","historical_precedent":""}]`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2200,
        system,
        messages: [{ role: 'user', content: 'Run the current Media to Market weekly research scan.' }],
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }]
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data?.error?.message || `Anthropic request failed (${response.status})`);

    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text || '').join('\n').trim();
    const sources = [];
    for (const block of textBlocks) {
      for (const c of block.citations || []) if (c.url) sources.push(c.url);
    }
    for (const block of data.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) sources.push(r.url);
      }
    }

    let clean = text.replace(/```json/gi,'').replace(/```/g,'').trim();
    const match = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) clean = match[0];
    const items = JSON.parse(clean);
    if (!Array.isArray(items)) throw new Error('Model response was not an array.');

    return res.status(200).json({ items, sources: [...new Set(sources)].slice(0, 12) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}
