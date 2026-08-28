// api/scan.js — Media to Market research scan endpoint
//
// CHANGE (this revision): expanded rhetoric feature set from 5 to the full 9
// dimensions specified in the research brief; composite "Rhetoric Intensity"
// is now computed deterministically in this file (not invented by the model)
// so it is a documented, reproducible function of the sub-features; dataset
// schema expanded toward the full observation spec (IDs, org/country,
// per-item source separation, benchmark placeholder, outcome object with
// explicit nulls for fields that need Phase 3 structured market data).
//
// SECURITY: API key stays server-side via process.env.ANTHROPIC_API_KEY.
// Never move this call or the key into browser JavaScript.

// ---------------------------------------------------------------------------
// Rhetoric feature definitions (documented so scoring is consistent over time)
// ---------------------------------------------------------------------------
// Each feature is scored 1-10 unless noted. These definitions are the
// methodology — if you change wording here, note it in CHANGELOG.md, since
// it changes what past observations mean relative to new ones.
//
//   certainty          - how unequivocal the language is, independent of content
//   escalation         - degree the statement raises tension/conflict vs prior tone
//   urgency            - implied timeframe pressure ("immediately" vs "over time")
//   hedging            - qualifying/conditional language ("may", "could", "if")
//   novelty            - how much this deviates from the speaker's recent rhetoric
//   confidence     - speaker's expressed confidence in outcomes/forecasts
//   optimism_pessimism - directional valence, 1=pessimistic .. 10=optimistic,
//                        NULL if the statement expresses no economic outlook.
//                        Tracked separately — direction is not "intensity".
//   threat_coercion    - presence of threat/coercive framing; NULL if not
//                        applicable (most economic statements will be null)
//   policy_commitment  - how firmly a specific policy action is committed to;
//                        NULL if no concrete policy action is referenced
//
// COMPOSITE "Rhetoric Intensity" = simple mean of whichever of
// [certainty, escalation, urgency, hedging, novelty, confidence,
//  threat_coercion, policy_commitment] are non-null for that observation.
// optimism_pessimism is excluded from the composite because it is a
// direction, not a magnitude — averaging it in would let strong optimism
// and strong pessimism cancel out, which is exactly backwards.
const INTENSITY_COMPONENTS = [
  'certainty', 'escalation', 'urgency', 'hedging', 'novelty',
  'confidence', 'threat_coercion', 'policy_commitment'
];

function computeCompositeIntensity(features) {
  const values = INTENSITY_COMPONENTS
    .map(k => features?.[k])
    .filter(v => typeof v === 'number' && !Number.isNaN(v));
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 10) / 10;
}

// Sector -> standard ETF ticker. Computed here, not by the model, so it's
// always consistent. Sector -> benchmark is a flat placeholder (broad market
// index) until Phase 3 introduces real sector-specific benchmarks and
// abnormal-return calculation.
const SECTOR_TICKERS = {
  'Energy': 'XLE', 'Financials': 'XLF', 'Technology': 'XLK',
  'Industrials': 'XLI', 'Materials': 'XLB', 'Healthcare': 'XLV',
  'Consumer Discretionary': 'XLY', 'Consumer Staples': 'XLP', 'Utilities': 'XLU',
  'Real Estate': 'XLRE', 'Communication Services': 'XLC', 'Agriculture': 'DBA',
  'Autos': 'CARZ', 'Semiconductors': 'SMH', 'Banks': 'KBE',
  'Defense': 'ITA', 'Airlines': 'JETS', 'Retail': 'XRT', 'Homebuilders': 'XHB'
};
const DEFAULT_BENCHMARK = 'S&P 500 (SPY) — placeholder benchmark; Phase 3 will use sector-specific benchmarks';

function genObservationId() {
  return 'obs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

const SYSTEM_PROMPT = `You are the research engine for Media to Market, an experimental analytics platform studying whether rhetoric itself contains information about subsequent market behaviour, independent of the underlying event's importance.

Research 3 significant market-relevant statements from the LAST 7 DAYS by central bankers, finance ministers, trade officials, heads of state, or major public-company executives. Prioritize primary sources (transcripts, official releases, earnings calls) over secondary reporting when available; use high-quality financial/news reporting otherwise.

For each item, distinguish the UNDERLYING EVENT (what occasion/venue this happened at) from the STATEMENT (what was actually said) from the RHETORICAL FORM (how it was said). Score rhetoric independently of whether the policy/event is objectively important — a minor speaker using extreme language scores differently than a major speaker using measured language.

Return these exact fields per item:
- speaker, role, organization, country
- underlying_event: short description of the occasion (e.g. "July FOMC press conference"), separate from the statement itself
- statement_date: date of the statement (YYYY-MM-DD if known)
- statement_summary: one short paraphrase, never a long direct quote
- source_url: the specific URL of the original statement/transcript if you can identify one, else null — never fabricate a URL
- source_type: one of "primary_transcript", "financial_press", "general_news", or "unknown"
- rhetoric_type: short tag such as Escalation, Hedged Certainty, De-escalation, Forward Guidance Shift, Threat Signal, Confidence Signal
- rhetoric_features: an object with these 8 fields, each scored 1-10, or null if the dimension does not apply to this statement:
  - certainty, escalation, urgency, hedging, novelty, confidence (always score these six)
  - threat_coercion (null unless the statement contains real threat/coercive framing)
  - policy_commitment (null unless a specific policy action is referenced)
- optimism_pessimism: 1-10 where 1=strongly pessimistic, 10=strongly optimistic, null if the statement expresses no view on economic outlook
- analysis_confidence: 1-10, YOUR confidence in this classification given the evidence available (this is about your certainty as the analyst, not the speaker's rhetoric)
- sectors: 1-3 sectors using stable standard names: Energy, Financials, Technology, Industrials, Materials, Healthcare, Consumer Discretionary, Consumer Staples, Utilities, Real Estate, Communication Services, Agriculture, Autos, Semiconductors, Banks, Defense, Airlines, Retail, Homebuilders
- market_aftermath: one factual sentence describing what the relevant market/sector actually did AFTER the statement, based on real search results; if not confirmable, say so plainly
- verification_source_url: URL used to confirm market_aftermath, if identifiable, else null
- market_move_magnitude: 0-10 observed-move score, independent from rhetoric intensity; use 0 when aftermath cannot be confirmed at all
- historical_precedent: one short comparable historical pattern if genuinely supportable; otherwise state plainly that no strong precedent was identified
- forward_hypothesis: one sentence framed explicitly as a research hypothesis about what this rhetoric pattern might imply going forward — never as a prediction, certainty, or trading advice

Important research rules:
1. Never invent facts, statements, prices, dates, URLs, aftermath, or precedent. Use null rather than guessing.
2. Keep rhetoric features and market outcome fully independent — a high-rhetoric item can have a small market outcome and that is a valid, useful result, not an error.
3. Never claim causation from correlation or sequential timing.
4. Never present this as financial advice or a trading signal — use language like "research signal", "observed aftermath", "hypothesis", "association".
5. Keep every text field to one concise sentence.
6. Respond with ONLY one raw JSON array, no markdown fences, no commentary, no citation brackets like [1] in the text.

Schema:
[{"speaker":"","role":"","organization":"","country":"","underlying_event":"","statement_date":"","statement_summary":"","source_url":null,"source_type":"","rhetoric_type":"","rhetoric_features":{"certainty":0,"escalation":0,"urgency":0,"hedging":0,"novelty":0,"confidence":0,"threat_coercion":null,"policy_commitment":null},"optimism_pessimism":null,"analysis_confidence":0,"sectors":[""],"market_aftermath":"","verification_source_url":null,"market_move_magnitude":0,"historical_precedent":"","forward_hypothesis":""}]`;

// Vercel's default function timeout is 10 seconds. This scan does multiple
// rounds of real web research per statement and can genuinely take longer
// than that, so the timeout must be extended explicitly or Vercel kills the
// function mid-request — which the browser sees as a generic network
// failure, not a clean error message. 60 is the maximum allowed on the
// Hobby plan without enabling Fluid Compute (which allows up to 300).
export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });

  const scanTimestamp = new Date().toISOString();

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
        max_tokens: 3500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'Run the current Media to Market weekly research scan.' }],
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }]
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data?.error?.message || `Anthropic request failed (${response.status})`);

    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text || '').join('\n').trim();

    const pooledSources = [];
    for (const block of textBlocks) {
      for (const c of block.citations || []) if (c.url) pooledSources.push(c.url);
    }
    for (const block of data.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) pooledSources.push(r.url);
      }
    }

    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) clean = match[0];
    const rawItems = JSON.parse(clean);
    if (!Array.isArray(rawItems)) throw new Error('Model response was not an array.');

    // Attach deterministic fields the model should never invent: observation
    // ID, composite intensity, ticker/benchmark mapping, and the outcome
    // object with explicit nulls for fields that need real market data.
    const items = rawItems.map(raw => {
      const features = raw.rhetoric_features || {};
      const compositeIntensity = computeCompositeIntensity(features);
      const sectors = Array.isArray(raw.sectors) ? raw.sectors : [];
      const tickers = sectors.map(s => SECTOR_TICKERS[s] || null).filter(Boolean);

      return {
        observation_id: genObservationId(),
        scan_timestamp: scanTimestamp,
        speaker: raw.speaker ?? null,
        role: raw.role ?? null,
        organization: raw.organization ?? null,
        country: raw.country ?? null,
        underlying_event: raw.underlying_event ?? null,
        statement_date: raw.statement_date ?? null,
        statement_summary: raw.statement_summary ?? null,
        source_url: raw.source_url ?? null,
        source_type: raw.source_type ?? 'unknown',
        rhetoric_type: raw.rhetoric_type ?? null,
        rhetoric_features: {
          certainty: features.certainty ?? null,
          escalation: features.escalation ?? null,
          urgency: features.urgency ?? null,
          hedging: features.hedging ?? null,
          novelty: features.novelty ?? null,
          confidence: features.confidence ?? null,
          threat_coercion: features.threat_coercion ?? null,
          policy_commitment: features.policy_commitment ?? null
        },
        optimism_pessimism: raw.optimism_pessimism ?? null,
        composite_intensity: compositeIntensity,
        analysis_confidence: raw.analysis_confidence ?? null,
        sectors,
        tickers,
        benchmark: DEFAULT_BENCHMARK,
        market_aftermath: raw.market_aftermath ?? null,
        verification_source_url: raw.verification_source_url ?? null,
        outcome: {
          observed_move_magnitude: raw.market_move_magnitude ?? 0,
          verified: !!raw.verification_source_url,
          asset_return: null,
          sector_return: null,
          benchmark_return: null,
          abnormal_return: null,
          volatility_change: null,
          volume_change: null,
          note: 'Return/volatility/volume fields require a structured market-data provider (Phase 3) and are intentionally null until then.'
        },
        historical_precedent: raw.historical_precedent ?? null,
        forward_hypothesis: raw.forward_hypothesis ?? null
      };
    });

    return res.status(200).json({
      items,
      sources: [...new Set(pooledSources)].slice(0, 12),
      scan_timestamp: scanTimestamp
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Scan failed' });
  }
}
