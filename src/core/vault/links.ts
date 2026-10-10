import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Finds unresolved wikilinks, embeds and relative markdown links (V-VAULT), resolving them the way
// Obsidian does: a path from the vault root, or a unique file name anywhere in the vault.

export interface LinkIssue {
  file: string;
  link: string;
}

function walk(dir: string, out: string[], budget: { n: number }): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (budget.n-- <= 0) return;
    if (n.startsWith('.')) continue;
    const abs = path.join(dir, n);
    if (statSync(abs).isDirectory()) walk(abs, out, budget);
    else out.push(abs);
  }
}

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function checkLinks(vaultRoot: string, under = 'Scaffold'): LinkIssue[] {
  const files: string[] = [];
  walk(vaultRoot, files, { n: 50_000 });
  const rels = files.map((f) => path.relative(vaultRoot, f).split(path.sep).join('/'));
  const relSet = new Set(rels.map((r) => r.toLowerCase()));
  const byName = new Map<string, number>();
  for (const r of rels) {
    const b = r.split('/').pop()!.toLowerCase();
    byName.set(b, (byName.get(b) ?? 0) + 1);
    const noExt = b.replace(/\.md$/, '');
    if (noExt !== b) byName.set(noExt, (byName.get(noExt) ?? 0) + 1);
  }
  const resolves = (target: string): boolean => {
    const t = decodeURI(target).replace(/^\.\//, '').toLowerCase();
    if (!t) return true; // same-note heading link
    if (relSet.has(t) || relSet.has(`${t}.md`)) return true;
    if (!t.includes('/')) return (byName.get(t) ?? 0) > 0 || (byName.get(`${t}.md`) ?? 0) > 0;
    return false;
  };
  const issues: LinkIssue[] = [];
  for (let i = 0; i < files.length; i++) {
    const rel = rels[i]!;
    if (!rel.startsWith(under) || !rel.endsWith('.md')) continue;
    const text = stripCode(readFileSync(files[i]!, 'utf8'));
    for (const m of text.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
      const target = m[1]!.split('|')[0]!.split('#')[0]!.replace(/\\$/, '').trim();
      if (!resolves(target)) issues.push({ file: rel, link: m[0] });
    }
    for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      if (!resolves(target.split('#')[0]!)) issues.push({ file: rel, link: m[0] });
    }
  }
  return issues;
}

export function fileExists(vaultRoot: string, rel: string): boolean {
  return existsSync(path.join(vaultRoot, ...rel.split('/')));
}
