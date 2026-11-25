import fs from "node:fs";
import type { Policy } from "./config.js";
import type { MarketSnapshot } from "./market.js";
import type { Decision } from "./strategy.js";
import type { AgentState } from "./state.js";

/** Returns blocking reasons; an empty list means the trade is allowed. */
export function preTradeChecks(p: Policy, m: MarketSnapshot, d: Decision, s: AgentState, now = Date.now()): string[] {
  const r = p.risk, out: string[] = [];
  if (fs.existsSync(r.killSwitchFile)) out.push(`kill switch present (${r.killSwitchFile})`);
  if (d.action === "HOLD") return out;
  if (d.tradeUsd < r.minTradeUsd) out.push(`trade $${d.tradeUsd.toFixed(2)} below min $${r.minTradeUsd}`);
  if (d.tradeUsd > r.maxTradeUsd + 1e-9) out.push(`trade exceeds maxTradeUsd`);
  if (m.oracleDivergencePct === null) out.push("second oracle (Pyth) unavailable: refusing to trade blind");
  else if (m.oracleDivergencePct > r.maxOracleDivergencePct)
    out.push(`Jupiter/Pyth divergence ${m.oracleDivergencePct.toFixed(2)}% > ${r.maxOracleDivergencePct}%`);
  if (Math.abs(m.usdcUsd - 1) > 0.01) out.push(`USDC off peg (${m.usdcUsd.toFixed(4)})`);

  const dayAgo = now - 86_400_000;
  const today = s.trades.filter((t) => Date.parse(t.ts) > dayAgo);
  if (today.length >= r.maxTradesPerDay) out.push(`maxTradesPerDay (${r.maxTradesPerDay}) reached`);
  const notional = today.reduce((x, t) => x + t.usd, 0);
  if (notional + d.tradeUsd > r.maxDailyNotionalUsd) out.push(`daily notional cap $${r.maxDailyNotionalUsd} would be exceeded`);
  const last = s.trades.at(-1);
  if (last && now - Date.parse(last.ts) < r.minMinutesBetweenTrades * 60_000) out.push(`cooldown ${r.minMinutesBetweenTrades}m active`);
  if (s.peakEquityUsd && d.equityUsd < s.peakEquityUsd * (1 - r.drawdownHaltPct / 100))
    out.push(`drawdown halt: equity $${d.equityUsd.toFixed(2)} < ${100 - r.drawdownHaltPct}% of peak $${s.peakEquityUsd.toFixed(2)}`);
  return out;
}

/** Checks on the concrete Jupiter quote. */
export function quoteChecks(p: Policy, q: { priceImpactPct: string; slippageBps: number }): string[] {
  const out: string[] = [];
  const impact = Number(q.priceImpactPct) * 100;
  if (impact > p.risk.maxPriceImpactPct) out.push(`price impact ${impact.toFixed(3)}% > ${p.risk.maxPriceImpactPct}%`);
  if (q.slippageBps > p.risk.maxSlippageBps) out.push(`slippage ${q.slippageBps}bps > ${p.risk.maxSlippageBps}bps`);
  return out;
}
