import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { config } from "./config.js";

/** Creates a fresh agent keypair (0600, gitignored). Never prints the secret. */
export function generateKeypair(file = config.keypairPath): PublicKey {
  if (fs.existsSync(file)) throw new Error(`Refusing to overwrite existing keypair at ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp.publicKey;
}

export function loadKeypair(file = config.keypairPath): Keypair {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Wallet the agent reasons about: WATCH_WALLET (read-only) or the local agent key. */
export function agentPubkey(): PublicKey {
  if (config.watchWallet) return new PublicKey(config.watchWallet);
  if (!fs.existsSync(config.keypairPath)) throw new Error("No agent keypair. Run `npm run keygen` first.");
  return loadKeypair().publicKey;
}
