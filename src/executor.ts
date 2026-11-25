import { Connection, VersionedTransaction } from "@solana/web3.js";
import { config, DECIMALS, MINTS, type Policy } from "./config.js";
import type { Decision } from "./strategy.js";
import type { MarketSnapshot } from "./market.js";
import { quoteChecks } from "./risk.js";
import { loadKeypair } from "./wallet.js";

export interface ExecResult {
  mode: "dry-run" | "live";
  quote?: { inAmount: string; outAmount: string; priceImpactPct: string; route: string[] };
  blocked?: string[];
  signature?: string;
  simulated?: boolean;
}

export async function getQuote(inputMint: string, outputMint: string, amountRaw: bigint, slippageBps: number) {
  const u = new URL(`${config.jupiterBase}/quote`);
  u.search = new URLSearchParams({
    inputMint, outputMint, amount: amountRaw.toString(), slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
  }).toString();
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Jupiter quote ${r.status}: ${await r.text()}`);
  return (await r.json()) as any;
}

/** Quote always; sign + send only when DRY_RUN=false AND --live was passed. */
export async function execute(p: Policy, m: MarketSnapshot, d: Decision, liveFlag: boolean): Promise<ExecResult> {
  const live = !config.dryRun && liveFlag;
  const mode = live ? "live" : "dry-run";
  const sell = d.action === "SELL_SOL";
  const inputMint = sell ? MINTS.SOL : MINTS.USDC;
  const outputMint = sell ? MINTS.USDC : MINTS.SOL;
  const amountRaw = sell
    ? BigInt(Math.floor((d.tradeUsd / m.solUsdJupiter) * 10 ** DECIMALS.SOL))
    : BigInt(Math.floor((d.tradeUsd / m.usdcUsd) * 10 ** DECIMALS.USDC));

  const q = await getQuote(inputMint, outputMint, amountRaw, p.risk.maxSlippageBps);
  const quote = {
    inAmount: q.inAmount, outAmount: q.outAmount, priceImpactPct: q.priceImpactPct,
    route: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label ?? "?"),
  };
  const blocked = quoteChecks(p, q);
  if (blocked.length) return { mode, quote, blocked };
  if (!live) return { mode, quote };

  // ---- LIVE PATH (never reached in dry-run) ----
  const kp = loadKeypair();
  const sr = await fetch(`${config.jupiterBase}/swap`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: kp.publicKey.toBase58(), dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: "medium" } } }),
  });
  if (!sr.ok) throw new Error(`Jupiter swap ${sr.status}: ${await sr.text()}`);
  const { swapTransaction } = (await sr.json()) as any;
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([kp]);
  const conn = new Connection(config.rpcUrl, "confirmed");
  const sim = await conn.simulateTransaction(tx, { sigVerify: true });
  if (sim.value.err) return { mode, quote, blocked: [`simulation failed: ${JSON.stringify(sim.value.err)}`], simulated: true };
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction(signature, "confirmed");
  return { mode, quote, signature, simulated: true };
}
