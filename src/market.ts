import { Connection, PublicKey } from "@solana/web3.js";
import { config, MINTS, PYTH_SOL_USD } from "./config.js";
import { SapMcp } from "./sapMcp.js";

export interface MarketSnapshot {
  ts: string;
  solUsdJupiter: number;
  solUsdPyth: number | null;
  usdcUsd: number;
  solChange24hPct: number;
  oracleDivergencePct: number | null;
}

export interface Holdings { sol: number; usdc: number; }

export async function getMarket(sap: SapMcp): Promise<MarketSnapshot> {
  const px = await sap.call<Record<string, { usdPrice: number; priceChange24h?: number }>>(
    "jupiter_getPrice", { ids: [MINTS.SOL, MINTS.USDC] });
  const sol = px[MINTS.SOL], usdc = px[MINTS.USDC];
  if (!sol?.usdPrice) throw new Error("No SOL price from SAP MCP jupiter_getPrice");
  const pyth = await getPythSolUsd().catch(() => null);
  return {
    ts: new Date().toISOString(),
    solUsdJupiter: sol.usdPrice,
    solUsdPyth: pyth,
    usdcUsd: usdc?.usdPrice ?? 1,
    solChange24hPct: sol.priceChange24h ?? 0,
    oracleDivergencePct: pyth ? (Math.abs(sol.usdPrice - pyth) / pyth) * 100 : null,
  };
}

/** Pyth SOL/USD sponsored push-oracle account (PriceUpdateV2, shard 0). */
export const PYTH_SOL_USD_ACCOUNT = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
const MAX_PYTH_AGE_SEC = 300;

/** Independent second oracle: Pyth price read directly on-chain (no API key needed). */
async function getPythSolUsd(): Promise<number> {
  const conn = new Connection(config.rpcUrl, "confirmed");
  const acc = await conn.getAccountInfo(new PublicKey(PYTH_SOL_USD_ACCOUNT));
  if (!acc) throw new Error("pyth account missing");
  const d = acc.data;
  let o = 8 + 32; // discriminator + write_authority
  o += d[o] === 0 ? 2 : 1; // VerificationLevel: Partial{u8} | Full
  const feedId = d.subarray(o, o + 32).toString("hex"); o += 32;
  if (feedId !== PYTH_SOL_USD) throw new Error("unexpected pyth feed id");
  const price = d.readBigInt64LE(o); o += 8;
  o += 8; // conf
  const expo = d.readInt32LE(o); o += 4;
  const publishTime = Number(d.readBigInt64LE(o));
  if (Date.now() / 1000 - publishTime > MAX_PYTH_AGE_SEC) throw new Error("pyth price stale");
  return Number(price) * 10 ** expo;
}

export async function getHoldings(sap: SapMcp, owner: PublicKey): Promise<Holdings> {
  const bal = await sap.call<{ sol: number }>("sol_get_balance", { address: owner.toBase58() });
  const conn = new Connection(config.rpcUrl, "confirmed");
  const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(MINTS.USDC) });
  const usdc = accts.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  return { sol: bal.sol ?? 0, usdc };
}
