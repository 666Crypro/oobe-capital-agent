# OOBE Capital Agent

A risk-first, explainable **autonomous SOL/USDC capital agent** built for the
[Steve Capital Agent Challenge](https://superteam.fun/earn/listing/build-an-autonomous-capital-agent-on-solana-and-compete-for-dollar500-in-rewards/)
by OOBE Protocol, with optional MultiHopper and Ace Data Cloud workflows.

It reads markets through OOBE's hosted **SAP MCP** (the same tool registry that powers Steve
Capital), cross-checks prices against an on-chain **Pyth** oracle, decides with a transparent
trend-tilted band rebalancer, and executes through **Jupiter** only when every guardrail passes.
**Dry-run is the default**: nothing is ever signed or sent unless you set `DRY_RUN=false` *and*
pass `--live`.

> The bounty is scored on Steve Capital (Arena XP). Run your scored agent on Steve Capital using
> [`docs/steve-mandate.md`](docs/steve-mandate.md); this repo is the open, testable reference
> implementation of the same mandate, a companion runner, and the content source for your posts.

## Architecture

```
            ┌──────────────── OOBE SAP MCP (hosted, Streamable HTTP) ───────────────┐
            │  jupiter_getPrice (free)      sol_get_balance (free)     453 tools    │
            └───────────────┬──────────────────────────────┬────────────────────────┘
                            │ prices                       │ balances
  Pyth on-chain ─────► market.ts ──► strategy.ts ──► risk.ts ──► executor.ts ──► Jupiter quote
  (SOL/USD push feed)   snapshot      decide()      preTrade     (dry-run: quote only)
                                                      checks      (live: build, sign locally,
                                                                   simulate, send)
                                │                                     │
                                ▼                                     ▼
                     multihopper.ts (profit sweep plan/estimate)   state/journal.jsonl
                     ace.ts (daily SERP market brief)              state/daily-report.md (+ X draft)
```

| File | Role |
| --- | --- |
| `src/sapMcp.ts` | MCP client for `https://mcp.sap.oobeprotocol.ai/mcp` (free read tools only) |
| `src/market.ts` | Jupiter price via SAP MCP, Pyth SOL/USD read directly from its on-chain account, holdings |
| `src/strategy.ts` | Trend-tilted band rebalancer (pure function, unit tested) |
| `src/risk.ts` | Pre-trade and quote guardrails (pure functions, unit tested) |
| `src/executor.ts` | Jupiter quote; live path signs locally, simulates, then sends |
| `src/multihopper.ts` | High-water-mark profit distribution plan + MultiHopper `/transfers/estimate` |
| `src/ace.ts` | Ace Data Cloud Google SERP market brief |
| `src/wallet.ts` | Fresh agent keypair in `.secrets/` (gitignored, 0600, never printed) |
| `policy.json` | All mandate and risk parameters in one place |

## Strategy

1. Neutral target 50% SOL / 50% USDC.
2. Tilt +10 pp SOL per +10% trend (price vs slow EMA, falling back to 24h change), clamped to 25–75%.
3. Rebalance only when drift exceeds ±7 pp. Otherwise HOLD. This keeps turnover low and makes
   wash-like churn impossible by construction.
4. Each trade moves toward target, capped at `maxTradeUsd`.

## Risk controls

| Guard | Default |
| --- | --- |
| Max trade | $10 |
| Daily notional / trades | $40 / 4 per 24h |
| Cooldown | 120 min between trades |
| Slippage / price impact | 50 bps / 0.3% |
| Oracle check | Jupiter vs Pyth divergence must be ≤ 1%; no trade if Pyth is missing or stale (>5 min) |
| Stablecoin check | USDC within 1% of $1 |
| Fee reserve | 0.03 SOL never sold |
| Drawdown halt | stop if equity < 80% of peak |
| Kill switch | `touch state/KILL` |
| Live gating | `DRY_RUN=false` **and** `--live`; transaction simulated before send |

## Setup

```bash
git clone https://github.com/666Crypro/oobe-capital-agent && cd oobe-capital-agent
npm install
cp .env.example .env
npm run keygen      # creates .secrets/agent-keypair.json, prints only the public address
npm run doctor      # checks SAP MCP connectivity (453 tools), mode, keys
npm test            # strategy + risk unit tests
npm run tick        # one dry-run decision on the real (empty) wallet
npm run cli -- tick --paper 0.3,2   # dry-run with paper holdings: 0.3 SOL + 2 USDC
npm run report      # daily report + draft X post in state/daily-report.md
```

To watch your Steve Capital agent wallet read-only, set `WATCH_WALLET=<address>` in `.env`.

## Funding and running live (operator only)

1. Back up `.secrets/agent-keypair.json` offline.
2. Send at least 20 USD of value to the agent address (for example 0.15 SOL + 10 USDC). Keep this
   wallet small and separate from your main wallet.
3. Optionally set `SOLANA_RPC_URL` to a private RPC.
4. Set `DRY_RUN=false` in `.env`, then run `npm run loop -- --live --interval 15`.
5. Stop at any time with `touch state/KILL` (or Ctrl-C).

## Side tracks

- **MultiHopper**: set `profitSweep.enabled=true`, `MULTIHOPPER_API_KEY`, and `MULTIHOPPER_RECIPIENTS`
  (real payees, not your own wallets: self and circular transfers are excluded). The runner plans and
  estimates the route; execute it through the MultiHopper MCP in your Steve Capital agent's MCP Workspace
  so it originates from your registered agent wallet.
- **Ace Data Cloud**: set `ACE_API_KEY` backed by **purchased** credits; `npm run cli -- ace-brief`
  makes one paid Google SERP request per run. Connect Ace MCP inside Steve Capital too.

## Disclaimer

Experimental software, no warranty. Crypto trading can lose money. Never fund this wallet with more
than you can afford to lose.

MIT License.
