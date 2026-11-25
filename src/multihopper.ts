import crypto from "node:crypto";
import { config, DECIMALS, MINTS, type Policy } from "./config.js";
import type { AgentState } from "./state.js";

/**
 * MultiHopper side track: "profit distribution" workflow.
 * When equity sets a new high-water mark by >= highWaterMarkStepUsd, the agent plans to route
 * `sweepFractionOfGain` of the gain (in USDC) to real recipients (e.g. contributors/bills) via a
 * multi-hop MultiHopper route. Here we only ESTIMATE (free dry run endpoint); creating/preparing/signing
 * a transfer is left to the Steve Capital agent's MultiHopper MCP or to the operator.
 */
export function planSweep(p: Policy, equityUsd: number, s: AgentState) {
  const hwm = s.lastSweepHwmUsd ?? equityUsd;
  const gain = equityUsd - hwm;
  if (!p.profitSweep.enabled) return { due: false, reason: "profitSweep disabled in policy.json", gain };
  if (gain < p.profitSweep.highWaterMarkStepUsd) return { due: false, reason: `gain $${gain.toFixed(2)} < step`, gain };
  if (!config.mhRecipients.length) return { due: false, reason: "no MULTIHOPPER_RECIPIENTS configured", gain };
  return { due: true, amountUsd: +(gain * p.profitSweep.sweepFractionOfGain).toFixed(2), recipients: config.mhRecipients, gain };
}

export async function estimateRoute(amountUsdc: number, destinationCount: number, hops: number) {
  if (!config.mhKey) return { skipped: "MULTIHOPPER_API_KEY not set (offline plan only)" };
  const r = await fetch(`${config.mhBase}/transfers/estimate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.mhKey, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      tokenMint: MINTS.USDC, tokenDecimals: DECIMALS.USDC,
      amountRaw: String(Math.floor(amountUsdc * 10 ** DECIMALS.USDC)), hops, destinationCount,
    }),
  });
  const body = await r.json().catch(() => ({}));
  return r.ok ? body : { error: r.status, body };
}
