import type { Command } from 'commander';
import type { CliContext } from './run.js';

// CLI command groups added by later layers (anki: M6, visual: M7).
export type CliExtension = (program: Command, ctx: CliContext) => void;

const exts: CliExtension[] = [];

export function registerCliExtension(e: CliExtension): void {
  exts.push(e);
}

export function cliExtensions(): CliExtension[] {
  return exts;
}
