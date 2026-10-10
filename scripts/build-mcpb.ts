// Builds dist/scaffold-mcp.mcpb: a single-file bundle of the stdio server plus manifest.json,
// validated and packed with the official MCPB tooling (@anthropic-ai/mcpb).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; description: string };
const out = path.resolve('build/mcpb');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'server'), { recursive: true });

await build({
  entryPoints: ['src/mcp/index.ts'],
  outfile: path.join(out, 'server', 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'none',
  // some CommonJS dependencies call require(); give the ESM bundle one
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
cpSync('LICENSE', path.join(out, 'LICENSE'));

const manifest = {
  manifest_version: '0.3',
  name: 'scaffold',
  display_name: 'Scaffold tutor',
  version: pkg.version,
  description:
    'Learner model, planner and vault tools for the Scaffold tutor (local; no network except AnkiConnect on 127.0.0.1).',
  long_description:
    'Scaffold keeps an inspectable model of what you know, have forgotten and misremember, in your Obsidian vault. Pair it with the scaffold-tutor skill. Data stays local.',
  author: { name: 'Basam Ahmed' },
  repository: { type: 'git', url: 'https://github.com/BasamAhmed640/scaffold' },
  license: 'MIT',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs', '--vault', '${user_config.vault}'],
      env: {},
    },
  },
  user_config: {
    vault: {
      type: 'directory',
      title: 'Obsidian vault',
      description: 'The vault folder that contains Scaffold/ (run `scaffold init <vault>` once).',
      required: true,
    },
  },
  tools_generated: true,
  keywords: ['tutor', 'learning', 'obsidian', 'anki', 'spaced repetition'],
  compatibility: {
    platforms: ['win32', 'darwin', 'linux'],
    runtimes: { node: '>=20.0.0' },
  },
};
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const mcpb = path.resolve('node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');
execFileSync(process.execPath, [mcpb, 'validate', path.join(out, 'manifest.json')], { stdio: 'inherit' });
mkdirSync('dist', { recursive: true });
const target = path.resolve('dist/scaffold-mcp.mcpb');
rmSync(target, { force: true });
execFileSync(process.execPath, [mcpb, 'pack', out, target], { stdio: 'inherit' });
execFileSync(process.execPath, [mcpb, 'info', target], { stdio: 'inherit' });
