import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;
export const DECIMALS = { SOL: 9, USDC: 6 } as const;
export const PYTH_SOL_USD = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export interface Policy {
  assets: { base: "SOL"; quote: "USDC" };
  allocation: {
    neutralSolWeight: number; minSolWeight: number; maxSolWeight: number;
    trendTiltPer10Pct: number; rebalanceBand: number;
  };
  risk: {
    maxTradeUsd: number; maxDailyNotionalUsd: number; maxTradesPerDay: number;
    minMinutesBetweenTrades: number; maxSlippageBps: number; maxPriceImpactPct: number;
    maxOracleDivergencePct: number; minSolReserve: number; minTradeUsd: number;
    drawdownHaltPct: number; killSwitchFile: string;
  };
  profitSweep: {
    enabled: boolean; highWaterMarkStepUsd: number; sweepFractionOfGain: number;
    token: "USDC"; hops: number;
  };
}

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const config = {
  dryRun: env("DRY_RUN", "true").toLowerCase() !== "false",
  rpcUrl: env("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  keypairPath: env("AGENT_KEYPAIR_PATH", ".secrets/agent-keypair.json"),
  watchWallet: env("WATCH_WALLET"),
  sapMcpUrl: env("SAP_MCP_URL", "https://mcp.sap.oobeprotocol.ai/mcp"),
  jupiterBase: env("JUPITER_API_BASE", "https://lite-api.jup.ag/swap/v1"),
  mhKey: env("MULTIHOPPER_API_KEY"),
  mhBase: env("MULTIHOPPER_API_BASE", "https://multihopper.com/api/v1"),
  mhRecipients: env("MULTIHOPPER_RECIPIENTS").split(",").map((s: string) => s.trim()).filter(Boolean),
  aceKey: env("ACE_API_KEY"),
  aceBase: env("ACE_API_BASE", "https://api.acedata.cloud"),
  stateDir: "state",
};

export function loadPolicy(file = "policy.json"): Policy {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as Policy;
}
