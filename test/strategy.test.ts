import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/strategy.js";
import { preTradeChecks, quoteChecks } from "../src/risk.js";
import type { Policy } from "../src/config.js";
import fs from "node:fs";

const policy: Policy = JSON.parse(fs.readFileSync("policy.json", "utf8"));
const m = { ts: new Date().toISOString(), solUsdJupiter: 100, solUsdPyth: 100.2, usdcUsd: 1, solChange24hPct: 0, oracleDivergencePct: 0.2 };
const empty = { samples: 0, trades: [] as any[] };

test("holds inside band", () => {
  const d = decide(policy, m, { sol: 0.1, usdc: 10 }, 0);
  assert.equal(d.action, "HOLD");
});
test("sells overweight SOL, capped at maxTradeUsd", () => {
  const d = decide(policy, m, { sol: 1, usdc: 0 }, 0);
  assert.equal(d.action, "SELL_SOL");
  assert.equal(d.tradeUsd, policy.risk.maxTradeUsd);
});
test("buys underweight SOL", () => {
  const d = decide(policy, m, { sol: 0, usdc: 20 }, 0);
  assert.equal(d.action, "BUY_SOL");
  assert.ok(d.tradeUsd <= 10);
});
test("trend tilt is clamped", () => {
  const d = decide(policy, m, { sol: 0.1, usdc: 10 }, 500);
  assert.equal(d.targetSolWeight, policy.allocation.maxSolWeight);
});
test("never sells below SOL fee reserve", () => {
  const d = decide(policy, m, { sol: 0.05, usdc: 0 }, 0);
  assert.ok(d.tradeUsd <= (0.05 - policy.risk.minSolReserve) * 100 + 1e-9);
});
test("oracle divergence blocks", () => {
  const d = decide(policy, m, { sol: 1, usdc: 0 }, 0);
  assert.ok(preTradeChecks(policy, { ...m, oracleDivergencePct: 3 }, d, empty).some((x) => x.includes("divergence")));
});
test("missing second oracle blocks", () => {
  const d = decide(policy, m, { sol: 1, usdc: 0 }, 0);
  assert.ok(preTradeChecks(policy, { ...m, oracleDivergencePct: null, solUsdPyth: null }, d, empty).length > 0);
});
test("cooldown and daily caps block", () => {
  const d = decide(policy, m, { sol: 1, usdc: 0 }, 0);
  const s = { samples: 1, trades: [{ ts: new Date().toISOString(), usd: 35, side: "SELL_SOL" }] };
  const r = preTradeChecks(policy, m, d, s);
  assert.ok(r.some((x) => x.includes("cooldown")));
  assert.ok(r.some((x) => x.includes("daily notional")));
});
test("drawdown halt", () => {
  const d = decide(policy, m, { sol: 1, usdc: 0 }, 0);
  assert.ok(preTradeChecks(policy, m, d, { samples: 1, trades: [], peakEquityUsd: 200 } as any).some((x) => x.includes("drawdown")));
});
test("quote impact guard", () => {
  assert.equal(quoteChecks(policy, { priceImpactPct: "0.0001", slippageBps: 50 }).length, 0);
  assert.equal(quoteChecks(policy, { priceImpactPct: "0.01", slippageBps: 50 }).length, 1);
});
