import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// V-MCP: the .mcpb builds and validates with the official MCPB tooling; the JSON Schemas are current.
// (Installing it in Claude Desktop on Windows is a manual step, recorded in VERIFICATION.md.)

describe('MCPB bundle', () => {
  it('builds, validates and stays small', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-mcpb.ts'], {
      encoding: 'utf8',
      timeout: 300_000,
    });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout + r.stderr).toContain('Manifest schema validation passes!');
    const file = path.resolve('dist/scaffold-mcp.mcpb');
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(2_000_000);
    const info = execFileSync(
      process.execPath,
      ['node_modules/@anthropic-ai/mcpb/dist/cli/cli.js', 'info', file],
      { encoding: 'utf8' },
    );
    expect(info).toContain('scaffold');
  }, 300_000);

  it('exported JSON Schemas are current (IF-02)', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/export-schemas.ts', '--check'], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(0);
  }, 120_000);
});
