import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ScaffoldError } from '../envelope.js';

// ARC-12: configuration order: CLI flag > env SCAFFOLD_VAULT > user config file.
// IF-03: paths are confined to the vault root (no `..`, no absolute paths outside it, no symlink escapes).

export const SCAFFOLD_DIR = 'Scaffold';

export function userConfigPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (platform === 'win32') {
    const appData = env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'scaffold', 'config.json');
  }
  const xdg = env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config');
  return path.join(xdg, 'scaffold', 'config.json');
}

export interface VaultResolution {
  vault: string;
  source: 'flag' | 'env' | 'user-config';
}

export function resolveVault(
  opts: { flag?: string | undefined; env?: NodeJS.ProcessEnv; configPath?: string } = {},
): VaultResolution {
  const env = opts.env ?? process.env;
  if (opts.flag && opts.flag.trim()) return { vault: path.resolve(opts.flag.trim()), source: 'flag' };
  if (env.SCAFFOLD_VAULT && env.SCAFFOLD_VAULT.trim())
    return { vault: path.resolve(env.SCAFFOLD_VAULT.trim()), source: 'env' };
  const cfgPath = opts.configPath ?? userConfigPath(env);
  if (existsSync(cfgPath)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch {
      throw new ScaffoldError(
        'user_config_invalid',
        `User config ${cfgPath} is not valid JSON.`,
        `Fix or delete ${cfgPath}.`,
      );
    }
    const v = (raw as { vault?: unknown }).vault;
    if (typeof v === 'string' && v.trim()) return { vault: path.resolve(v), source: 'user-config' };
  }
  throw new ScaffoldError(
    'vault_not_configured',
    'No vault configured.',
    `Pass --vault <path>, set SCAFFOLD_VAULT, or run \`scaffold init <vault>\` (writes ${cfgPath}).`,
  );
}

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realOfNearestExisting(p: string): string {
  let cur = p;
  const tail: string[] = [];
  for (let i = 0; i < 4096; i++) {
    if (existsSync(cur)) return path.join(realpathSync.native(cur), ...tail.reverse());
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.push(path.basename(cur));
    cur = parent;
  }
  return p;
}

/**
 * Resolves a vault-relative path and confines it to the vault root (IF-03).
 * Rejects `..` segments, absolute paths outside the root, NUL bytes and symlink escapes.
 */
export function confine(root: string, relOrAbs: string): string {
  if (relOrAbs.includes('\0')) throw new ScaffoldError('path_rejected', 'Path contains a NUL byte.');
  const segments = relOrAbs.split(/[\\/]+/);
  if (segments.includes('..'))
    throw new ScaffoldError(
      'path_rejected',
      `Path "${relOrAbs}" contains "..".`,
      'Use a path inside the vault.',
    );
  const absRoot = path.resolve(root);
  const target = path.isAbsolute(relOrAbs) ? path.resolve(relOrAbs) : path.resolve(absRoot, relOrAbs);
  if (!isInside(absRoot, target))
    throw new ScaffoldError(
      'path_rejected',
      `Path "${relOrAbs}" is outside the vault.`,
      'Use a path inside the vault.',
    );
  const realRoot = existsSync(absRoot) ? realpathSync.native(absRoot) : absRoot;
  const realTarget = realOfNearestExisting(target);
  if (!isInside(realRoot, realTarget))
    throw new ScaffoldError(
      'path_rejected',
      `Path "${relOrAbs}" escapes the vault through a link.`,
      'Remove the link or use a path inside the vault.',
    );
  return target;
}

/** Vault-relative POSIX path, for links and messages. */
export function vaultRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}
