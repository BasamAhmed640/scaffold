import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allTools, callTool } from '../core/api/tools.js';
import { fail, ScaffoldError, type Envelope } from '../core/envelope.js';
import { Scaffold } from '../core/service/scaffold.js';
import { FakeClock, systemClock } from '../core/time.js';
import { resolveVault } from '../core/vault/paths.js';

// scaffold-mcp: a stdio MCP server exposing the same functions as the CLI (IF-01).
// It never fails on load (REL-03): if the vault cannot be opened, every tool returns the error
// with one next step, and `doctor` reports it.

export const SERVER_NAME = 'scaffold';
export const SERVER_VERSION = '0.1.0';
/** Oversized inputs are rejected before parsing (V-MCP). Visuals are the largest legitimate input. */
export const MAX_INPUT_BYTES = 1_200_000;

export interface ServerOptions {
  vault?: string | undefined;
  env?: NodeJS.ProcessEnv;
  /** Fixed clock for tests (SCAFFOLD_NOW). */
  now?: string | undefined;
  timezone?: string | undefined;
}

export const INSTRUCTIONS = [
  'Scaffold is the learner model behind the scaffold-tutor skill. Follow the Tutor Protocol in that skill.',
  'Start every tutoring session with start_session (pass the subject the learner named, if any).',
  'Never reveal an answer before the learner attempts it; call get_grading_key only after the answer and get_hint only on request or after a wrong attempt.',
  'Record every assessed answer with record_attempt (verbatim answer, confidence 1–4, evidence quotes). Close with an exit ticket and end_session.',
].join(' ');

export function createServer(opts: ServerOptions = {}): { server: McpServer; open: () => Scaffold } {
  const env = opts.env ?? process.env;
  let cached: Scaffold | null = null;
  const open = (): Scaffold => {
    if (cached) return cached;
    const r = resolveVault({ flag: opts.vault, env });
    const now = opts.now ?? env.SCAFFOLD_NOW;
    const tz = opts.timezone ?? env.SCAFFOLD_TZ;
    cached = Scaffold.open(r.vault, {
      clock: now ? new FakeClock(now) : systemClock,
      ...(tz ? { timezone: tz } : {}),
    });
    return cached;
  };
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of allTools().filter((t) => !t.cliOnly)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: !!tool.readOnly, openWorldHint: false },
      },
      async (args: unknown) => {
        let env: Envelope<unknown>;
        const size = Buffer.byteLength(JSON.stringify(args ?? {}), 'utf8');
        if (size > MAX_INPUT_BYTES) {
          env = fail({
            code: 'input_too_large',
            message: `Input is ${size} bytes (limit ${MAX_INPUT_BYTES}).`,
            next_step: 'Send less data, e.g. a smaller visual.',
          });
        } else {
          try {
            env = await callTool(open(), tool.name, args);
          } catch (e) {
            env =
              e instanceof ScaffoldError
                ? fail(e.toIssue())
                : fail({ code: 'internal_error', message: (e as Error).message });
            if (tool.name === 'doctor' && e instanceof ScaffoldError)
              env = {
                ok: false,
                data: { checks: [{ id: 'vault', ok: false, message: e.message, next_step: e.next_step }] },
                warnings: [],
                errors: [e.toIssue()],
              };
          }
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(env) }], isError: !env.ok };
      },
    );
  }
  return { server, open };
}

export function parseServerArgs(argv: string[]): ServerOptions {
  const out: ServerOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--vault') out.vault = argv[++i];
    else if (a.startsWith('--vault=')) out.vault = a.slice('--vault='.length);
  }
  // Claude Desktop passes an unset user_config value literally; treat it as "not given".
  if (out.vault && /^\$\{user_config\./.test(out.vault)) delete out.vault;
  return out;
}
