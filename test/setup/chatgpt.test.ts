import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { chatGptPlugin, registeredAppId } from '../../scripts/build-chatgpt.js';

const repo = mkdtempSync(path.join(tmpdir(), 'scaffold-chatgpt-'));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function unpack(archive: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, inflateRawSync(archive.subarray(start, start + compressedSize)));
    offset = start + compressedSize;
  }
  expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

describe('AD-01/C7 ChatGPT plugin package', () => {
  it('keeps the generated protocol intact, maps the registered app, and excludes local owner files', () => {
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '0.1.0', license: 'MIT' }));
    writeFileSync(path.join(repo, 'LICENSE'), 'MIT license\n');
    const skill = path.join(repo, 'skills', 'scaffold-tutor');
    mkdirSync(path.join(skill, 'references'), { recursive: true });
    const protocol =
      '---\nname: scaffold-tutor\ndescription: Tutor through Scaffold.\n---\nKeep keys in escrow.\n';
    writeFileSync(path.join(skill, 'SKILL.md'), protocol);
    writeFileSync(path.join(skill, 'references', 'anki.md'), 'Apply cards only after approval.\n');
    mkdirSync(path.join(repo, 'local'));
    writeFileSync(path.join(repo, 'local', 'owner.json'), 'private owner data');
    const archive = chatGptPlugin(repo, 'plugin_asdk_app_test123');
    const files = unpack(archive);
    expect([...files.keys()].sort()).toEqual([
      '.app.json',
      'LICENSE',
      'plugin.json',
      'skills/scaffold-tutor/SKILL.md',
      'skills/scaffold-tutor/references/anki.md',
    ]);
    const manifest = JSON.parse(files.get('plugin.json')!.toString()) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'scaffold-tutor',
      version: '0.1.0',
      extensions: {
        'com.openai': { apps: './.app.json', interface: { displayName: 'Scaffold Tutor' } },
      },
    });
    expect(JSON.parse(files.get('.app.json')!.toString())).toEqual({
      apps: { scaffold: { id: 'asdk_app_test123', required: true } },
    });
    expect(files.get('skills/scaffold-tutor/SKILL.md')!.toString()).toBe(protocol);
    expect(files.get('skills/scaffold-tutor/references/anki.md')).toEqual(
      readFileSync(path.join(skill, 'references', 'anki.md')),
    );
    expect(chatGptPlugin(repo, 'asdk_app_test123')).toEqual(archive);
  });

  it('rejects URLs, empty IDs and unrelated plugin IDs before packaging', () => {
    for (const id of ['', 'plugin_123', 'plugin_asdk_app_', 'https://chatgpt.com/plugin_asdk_app_test'])
      expect(() => registeredAppId(id)).toThrow('registered MCP connection id');
  });
});
