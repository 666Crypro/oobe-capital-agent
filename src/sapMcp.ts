import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.js";

/**
 * Thin client for OOBE's hosted SAP MCP (the same tool registry Steve Capital uses).
 * Only FREE read tools are called here; value-moving calls are signed locally.
 */
export class SapMcp {
  private client = new Client({ name: "oobe-capital-agent", version: "0.1.0" });
  private connected = false;
  toolCount = 0;

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(new StreamableHTTPClientTransport(new URL(config.sapMcpUrl)));
    this.connected = true;
  }

  /**
   * Counts tools on a separate session: some hosted tools return structuredContent that
   * does not match their declared outputSchema, and the SDK validates calls against
   * schemas it has cached from listTools. Keeping calls on a session that never listed avoids that.
   */
  async countTools(): Promise<number> {
    const c = new Client({ name: "oobe-capital-agent-doctor", version: "0.1.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(config.sapMcpUrl)));
    this.toolCount = (await c.listTools()).tools.length;
    await c.close();
    return this.toolCount;
  }

  async call<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.connect();
    const r: any = await this.client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.content).slice(0, 300)}`);
    const sc = r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
    // Tools wrap their payload as { success, result: "<json string>" } or return fields directly.
    if (typeof sc.result === "string") {
      try { return JSON.parse(sc.result) as T; } catch { return sc.result as T; }
    }
    return sc as T;
  }

  async close() { if (this.connected) await this.client.close(); }
}
