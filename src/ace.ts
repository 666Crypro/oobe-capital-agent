import { config } from "./config.js";

/**
 * Ace Data Cloud side track: market-context brief. One Google SERP request per run
 * (POST /serp/google). Only counts for the bounty when paid with PURCHASED Ace credits.
 * The brief is informational: it is written to the journal and the daily X draft,
 * it never overrides the risk engine.
 */
export async function marketBrief(query = "Solana SOL price news today") {
  if (!config.aceKey) return { skipped: "ACE_API_KEY not set" };
  const r = await fetch(`${config.aceBase}/serp/google`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.aceKey}` },
    body: JSON.stringify({ query, type: "news", number: 5 }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) return { error: r.status, body: j };
  const items = (j.news ?? j.organic ?? []).slice(0, 5).map((x: any) => ({ title: x.title, link: x.link ?? x.url }));
  return { query, items, traceId: j.trace_id };
}
