import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ScaffoldError } from '../envelope.js';
import { SCHEMA_VERSION } from './eventlog.js';
import { SCAFFOLD_DIR, userConfigPath } from './paths.js';
import { generatedTemplateFiles, templateRoot } from './template.js';

// VLT-04: `scaffold init <vault>` creates everything from vault-template/. It never overwrites
// an existing file, so re-running it on a used vault only fills in what is missing.

export interface InitResult {
  vault: string;
  created: string[];
  kept: string[];
  css_snippet: string | null;
  user_config: string | null;
  next_steps: string[];
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}

export function initVault(
  vaultRoot: string,
  opts: { setDefault?: boolean; env?: NodeJS.ProcessEnv; userConfig?: string } = {},
): InitResult {
  const root = path.resolve(vaultRoot);
  if (existsSync(root) && !statSync(root).isDirectory())
    throw new ScaffoldError(
      'vault_not_a_folder',
      `${root} is a file, not a folder.`,
      'Pass the Obsidian vault folder.',
    );
  mkdirSync(root, { recursive: true });
  const tplRoot = path.join(templateRoot(), SCAFFOLD_DIR);
  if (!existsSync(tplRoot))
    throw new ScaffoldError(
      'template_missing',
      `vault-template not found at ${tplRoot}.`,
      'Reinstall Scaffold.',
    );
  const target = path.join(root, SCAFFOLD_DIR);
  const created: string[] = [];
  const kept: string[] = [];

  const place = (rel: string, write: (abs: string) => void): void => {
    const abs = path.join(target, ...rel.split('/'));
    if (existsSync(abs)) {
      kept.push(`${SCAFFOLD_DIR}/${rel}`);
      return;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    write(abs);
    created.push(`${SCAFFOLD_DIR}/${rel}`);
  };

  for (const rel of walk(tplRoot)) {
    if (rel.endsWith('.gitkeep')) {
      mkdirSync(path.join(target, ...rel.split('/').slice(0, -1)), { recursive: true });
      continue;
    }
    place(rel, (abs) => copyFileSync(path.join(tplRoot, ...rel.split('/')), abs));
  }
  for (const [rel, text] of Object.entries(generatedTemplateFiles()))
    place(rel, (abs) => writeFileSync(abs, text, 'utf8'));
  place('_system/events.jsonl', (abs) => writeFileSync(abs, ''));
  if (!existsSync(path.join(target, '_system', 'schema-version')))
    place('_system/schema-version', (abs) => writeFileSync(abs, `${SCHEMA_VERSION}\n`));
  for (const d of ['_system/queue', '_system/backups', 'Learner/Weekly'])
    mkdirSync(path.join(target, ...d.split('/')), { recursive: true });

  // Scoped CSS snippet: only if this is an Obsidian vault (has .obsidian/).
  let css: string | null = null;
  const obsidian = path.join(root, '.obsidian');
  if (existsSync(obsidian)) {
    const snip = path.join(obsidian, 'snippets', 'scaffold.css');
    if (!existsSync(snip)) {
      mkdirSync(path.dirname(snip), { recursive: true });
      copyFileSync(path.join(target, '_system', 'scaffold.css'), snip);
      created.push('.obsidian/snippets/scaffold.css');
    }
    css = snip;
  }

  // ARC-12: remember the vault in the user config, unless another vault is already the default.
  const cfgPath = opts.userConfig ?? userConfigPath(opts.env);
  let userConfig: string | null = null;
  let existing: { vault?: string } = {};
  if (existsSync(cfgPath)) {
    try {
      existing = JSON.parse(readFileSync(cfgPath, 'utf8')) as { vault?: string };
    } catch {
      existing = {};
    }
  }
  if (!existing.vault || opts.setDefault) {
    mkdirSync(path.dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ ...existing, vault: root }, null, 2) + '\n');
    userConfig = cfgPath;
  }

  const next_steps = [
    css
      ? 'In Obsidian: Settings → Appearance → CSS snippets → enable "scaffold".'
      : 'Open the folder as an Obsidian vault, then run `scaffold init` again to install the CSS snippet.',
    'Run `scaffold doctor` to check Anki and the vault.',
  ];
  if (!userConfig && existing.vault && path.resolve(existing.vault) !== root)
    next_steps.push(
      `The default vault is still ${existing.vault}; pass --vault or run \`scaffold init --set-default\`.`,
    );
  return { vault: root, created, kept, css_snippet: css, user_config: userConfig, next_steps };
}
