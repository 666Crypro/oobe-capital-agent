import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface AgentState {
  emaSlow?: number;
  samples: number;
  highWaterMarkUsd?: number;
  lastSweepHwmUsd?: number;
  peakEquityUsd?: number;
  trades: { ts: string; usd: number; side: string; sig?: string }[];
}

const file = () => path.join(config.stateDir, config.dryRun ? "paper-state.json" : "state.json");

export function loadState(): AgentState {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return { samples: 0, trades: [] }; }
}
export function saveState(s: AgentState) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  s.trades = s.trades.slice(-200);
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
}
export function journal(entry: Record<string, unknown>) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.appendFileSync(path.join(config.stateDir, "journal.jsonl"), JSON.stringify(entry) + "\n");
}
