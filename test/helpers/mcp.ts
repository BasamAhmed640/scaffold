import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpHandle {
  client: Client;
  close(): Promise<void>;
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ env: Envelope; isError: boolean; ms: number }>;
}

export interface Envelope {
  ok: boolean;
  data: unknown;
  warnings: string[];
  errors: { code: string; message: string; next_step?: string }[];
}

/** Starts the real stdio server (tsx) and connects a real MCP client. */
export async function connectMcp(
  opts: { vault?: string; now?: string; env?: Record<string, string> } = {},
): Promise<McpHandle> {
  const args = ['--import', 'tsx', path.resolve('src/mcp/index.ts')];
  if (opts.vault) args.push('--vault', opts.vault);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  delete env.SCAFFOLD_VAULT;
  Object.assign(
    env,
    {
      SCAFFOLD_NOW: opts.now ?? '2026-10-09T18:00:00-04:00',
      SCAFFOLD_TZ: 'America/New_York',
      APPDATA: path.resolve('.tmp/no-user-config'),
    },
    opts.env ?? {},
  );
  const transport = new StdioClientTransport({ command: process.execPath, args, env, stderr: 'pipe' });
  const client = new Client({ name: 'scaffold-test', version: '0' });
  await client.connect(transport);
  return {
    client,
    close: () => client.close(),
    async call(name, a = {}) {
      const t0 = performance.now();
      const r = (await client.callTool({ name, arguments: a })) as {
        content: { type: string; text: string }[];
        isError?: boolean;
      };
      const ms = performance.now() - t0;
      const text = r.content[0]?.text ?? '';
      let env: Envelope;
      try {
        env = JSON.parse(text) as Envelope;
      } catch {
        // input validation errors from the SDK are plain text
        env = { ok: false, data: null, warnings: [], errors: [{ code: 'invalid_input', message: text }] };
      }
      return { env, isError: !!r.isError, ms };
    },
  };
}
