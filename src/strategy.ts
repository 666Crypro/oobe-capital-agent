import type { Policy } from "./config.js";
import type { Holdings, MarketSnapshot } from "./market.js";

export interface Decision {
  action: "HOLD" | "BUY_SOL" | "SELL_SOL";
  reason: string;
  equityUsd: number;
  solWeight: number;
  targetSolWeight: number;
  trendPct: number;
  /** USD notional to swap (already capped by maxTradeUsd), 0 on HOLD. */
  tradeUsd: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Trend-tilted band rebalancer.
 *  - Neutral SOL weight (e.g. 50%) tilted by trend: +trendTiltPer10Pct per +10% trend, clamped to [min,max].
 *  - Trade only when actual weight drifts more than `rebalanceBand` from target (no churn => no wash volume).
 *  - Each trade moves toward target, capped at maxTradeUsd.
 */
export function decide(p: Policy, m: MarketSnapshot, h: Holdings, trendPct: number): Decision {
  const a = p.allocation;
  const solUsd = h.sol * m.solUsdJupiter;
  const usdcUsd = h.usdc * m.usdcUsd;
  const equityUsd = solUsd + usdcUsd;
  const solWeight = equityUsd > 0 ? solUsd / equityUsd : 0;
  const targetSolWeight = clamp(a.neutralSolWeight + a.trendTiltPer10Pct * (trendPct / 10), a.minSolWeight, a.maxSolWeight);
  const base = { equityUsd, solWeight, targetSolWeight, trendPct };

  if (equityUsd <= 0) return { ...base, action: "HOLD", reason: "wallet empty (fund it to go live)", tradeUsd: 0 };
  const drift = solWeight - targetSolWeight;
  if (Math.abs(drift) <= a.rebalanceBand)
    return { ...base, action: "HOLD", reason: `drift ${(drift * 100).toFixed(1)}% within ±${a.rebalanceBand * 100}% band`, tradeUsd: 0 };

  let tradeUsd = Math.min(Math.abs(drift) * equityUsd, p.risk.maxTradeUsd);
  if (drift > 0) {
    const sellableUsd = Math.max(0, h.sol - p.risk.minSolReserve) * m.solUsdJupiter;
    tradeUsd = Math.min(tradeUsd, sellableUsd);
    return { ...base, action: "SELL_SOL", reason: `overweight SOL by ${(drift * 100).toFixed(1)}%`, tradeUsd };
  }
  tradeUsd = Math.min(tradeUsd, usdcUsd);
  return { ...base, action: "BUY_SOL", reason: `underweight SOL by ${(-drift * 100).toFixed(1)}%`, tradeUsd };
}

/** Exponential moving average update used for the trend signal. */
export function ema(prev: number | undefined, x: number, alpha: number): number {
  return prev === undefined ? x : prev + alpha * (x - prev);
}
