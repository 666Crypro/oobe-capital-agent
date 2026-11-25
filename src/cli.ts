#!/usr/bin/env node
import fs from "node:fs";
import { config, loadPolicy } from "./config.js";
import { SapMcp } from "./sapMcp.js";
import { getHoldings, getMarket, type Holdings } from "./market.js";
import { decide, ema } from "./strategy.js";
import { preTradeChecks } from "./risk.js";
import { execute } from "./executor.js";
import { journal, loadState, saveState } from "./state.js";
import { generateKeypair, agentPubkey } from "./wallet.js";
import { estimateRoute, planSweep } from "./multihopper.js";
import { marketBrief } from "./ace.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const fmt = (x: number, d = 2) => x.toFixed(d);

async function tick(sap: SapMcp) {
  const policy = loadPolicy(opt("policy") ?? "policy.json");
  const state = loadState();
  const owner = agentPubkey();
  const market = await getMarket(sap);

  let holdings: Holdings = await getHoldings(sap, owner);
  const paper = opt("paper");
  if (paper) {
    if (!config.dryRun) throw new Error("--paper is only allowed in DRY_RUN mode");
    const [sol, usdc] = paper.split(",").map(Number);
    holdings = { sol, usdc };
  }

  state.emaSlow = ema(state.emaSlow, market.solUsdJupiter, 0.1);
  state.samples += 1;
  const trendPct = state.samples >= 12 ? (market.solUsdJupiter / state.emaSlow - 1) * 100 : market.solChange24hPct;

  const d = decide(policy, market, holdings, trendPct);
  const blocked = preTradeChecks(policy, market, d, state);
  let exec;
  if (d.action !== "HOLD" && blocked.length === 0) {
    exec = await execute(policy, market, d, flag("live"));
    if (!exec.blocked?.length) state.trades.push({ ts: market.ts, usd: d.tradeUsd, side: d.action, sig: exec.signature ?? "DRY-RUN" });
  }
  state.peakEquityUsd = Math.max(state.peakEquityUsd ?? 0, d.equityUsd);
  const sweep = planSweep(policy, d.equityUsd, state);
  let sweepEstimate;
  if (sweep.due) sweepEstimate = await estimateRoute(sweep.amountUsd!, sweep.recipients!.length, policy.profitSweep.hops);
  saveState(state);

  const entry = { ts: market.ts, mode: config.dryRun ? "dry-run" : "live", wallet: owner.toBase58(), paper: !!paper,
    market, holdings, decision: d, blocked, exec, sweep, sweepEstimate };
  journal(entry);

  console.log(`\n[${market.ts}] ${entry.mode.toUpperCase()}  wallet ${owner.toBase58()}${paper ? "  (paper holdings)" : ""}`);
  console.log(`  SOL  jup $${fmt(market.solUsdJupiter)}  pyth $${market.solUsdPyth ? fmt(market.solUsdPyth) : "n/a"}  div ${market.oracleDivergencePct?.toFixed(3) ?? "n/a"}%  24h ${fmt(market.solChange24hPct)}%`);
  console.log(`  Holdings ${fmt(holdings.sol, 4)} SOL + ${fmt(holdings.usdc)} USDC = $${fmt(d.equityUsd)}`);
  console.log(`  SOL weight ${fmt(d.solWeight * 100, 1)}%  target ${fmt(d.targetSolWeight * 100, 1)}%  trend ${fmt(trendPct)}%`);
  console.log(`  Decision ${d.action}${d.tradeUsd ? ` $${fmt(d.tradeUsd)}` : ""}: ${d.reason}`);
  if (blocked.length) console.log(`  Risk BLOCKED: ${blocked.join("; ")}`);
  if (exec?.quote) console.log(`  Jupiter quote in=${exec.quote.inAmount} out=${exec.quote.outAmount} impact=${exec.quote.priceImpactPct} via ${exec.quote.route.join(" > ")}`);
  if (exec?.blocked?.length) console.log(`  Quote BLOCKED: ${exec.blocked.join("; ")}`);
  if (exec?.signature) console.log(`  Sent: https://solscan.io/tx/${exec.signature}`);
  else if (exec) console.log(`  ${exec.mode === "dry-run" ? "Dry-run: nothing signed or sent." : ""}`);
  console.log(`  Profit sweep (MultiHopper): ${sweep.due ? `due $${sweep.amountUsd}` : sweep.reason}`);
}

function report() {
  const f = `${config.stateDir}/journal.jsonl`;
  if (!fs.existsSync(f)) throw new Error("No journal yet. Run `npm run tick` first.");
  const rows = fs.readFileSync(f, "utf8").trim().split("\n").map((l: string) => JSON.parse(l)) as any[];
  const day = rows.filter((r) => Date.parse(r.ts) > Date.now() - 86_400_000);
  const trades = day.filter((r) => r.exec && !r.exec.blocked?.length);
  const blocks = day.filter((r) => r.blocked?.length || r.exec?.blocked?.length);
  const last = day.at(-1) ?? rows.at(-1);
  const md = `# Agent daily report (${new Date().toISOString().slice(0, 10)})

- Mode: ${last.mode}
- Wallet: \`${last.wallet}\`
- Ticks (24h): ${day.length}, trades: ${trades.length}, risk blocks: ${blocks.length}
- Equity: $${fmt(last.decision.equityUsd)} | SOL weight ${fmt(last.decision.solWeight * 100, 1)}% vs target ${fmt(last.decision.targetSolWeight * 100, 1)}%
- SOL $${fmt(last.market.solUsdJupiter)} (Jupiter via OOBE SAP MCP), Pyth divergence ${last.market.oracleDivergencePct?.toFixed(3) ?? "n/a"}%

## Trades
${trades.map((t) => `- ${t.ts} ${t.decision.action} $${fmt(t.decision.tradeUsd)} ${t.exec.signature ? `https://solscan.io/tx/${t.exec.signature}` : "(dry-run)"}`).join("\n") || "- none"}

## Risk engine blocks
${blocks.map((b) => `- ${b.ts}: ${[...(b.blocked ?? []), ...(b.exec?.blocked ?? [])].join("; ")}`).join("\n") || "- none"}

## Draft X post (edit before posting)
Day update on my @SteveCapitalOS agent: ${trades.length} rebalance(s), ${blocks.length} trade(s) vetoed by risk guardrails. SOL/USDC target ${fmt(last.decision.targetSolWeight * 100, 0)}% SOL, max $${loadPolicy().risk.maxTradeUsd}/trade, Jupiter+Pyth oracle check. Built on @OOBEonSol SAP MCP.
`;
  fs.writeFileSync(`${config.stateDir}/daily-report.md`, md);
  console.log(md);
}

async function main() {
  const sap = new SapMcp();
  try {
    switch (cmd) {
      case "keygen": {
        const pk = generateKeypair();
        console.log(`New agent wallet: ${pk.toBase58()}\nSecret key saved to ${config.keypairPath} (gitignored, chmod 600). Back it up offline; it is never printed.`);
        break;
      }
      case "pubkey": console.log(agentPubkey().toBase58()); break;
      case "doctor": {
        console.log(`SAP MCP ${config.sapMcpUrl}: ${await sap.countTools()} tools`);
        console.log(`Mode: ${config.dryRun ? "DRY-RUN" : "LIVE-CAPABLE (still needs --live)"}`);
        console.log(`Wallet: ${agentPubkey().toBase58()}`);
        console.log(`MultiHopper key: ${config.mhKey ? "set" : "not set"} | Ace key: ${config.aceKey ? "set" : "not set"}`);
        break;
      }
      case "tick": await tick(sap); break;
      case "loop": {
        const mins = Number(opt("interval") ?? 15);
        for (;;) {
          try { await tick(sap); } catch (e) { console.error("tick error:", (e as Error).message); }
          await new Promise((r) => setTimeout(r, mins * 60_000));
        }
      }
      case "report": report(); break;
      case "ace-brief": console.log(JSON.stringify(await marketBrief(opt("q")), null, 2)); break;
      case "mh-estimate": console.log(JSON.stringify(await estimateRoute(Number(opt("usdc") ?? 5), Number(opt("dest") ?? 1), Number(opt("hops") ?? 3)), null, 2)); break;
      default:
        console.log(`Usage: npm run cli -- <keygen|pubkey|doctor|tick|loop|report|ace-brief|mh-estimate> [--paper SOL,USDC] [--live] [--interval MIN]`);
    }
  } finally { if (cmd !== "loop") await sap.close(); }
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
