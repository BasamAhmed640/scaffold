import type { ToolDef } from './tools.js';

// Tools added by later layers (Anki: M6, visuals: M7). Kept separate so the core table stays small.
const registry: (() => ToolDef[])[] = [];

export function registerExtraTools(fn: () => ToolDef[]): void {
  registry.push(fn);
}

export function extraTools(): ToolDef[] {
  return registry.flatMap((fn) => fn());
}
