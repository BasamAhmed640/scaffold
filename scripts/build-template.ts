// Writes the generated files of vault-template/Scaffold/ (Home, Profile, ledger, _templates).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generatedTemplateFiles } from '../src/core/vault/template.js';

const root = path.resolve('vault-template/Scaffold');
for (const [rel, text] of Object.entries(generatedTemplateFiles())) {
  const abs = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  console.log('wrote', `vault-template/Scaffold/${rel}`);
}
