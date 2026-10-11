// AD-01/C7: package the generated Tutor Protocol with an existing ChatGPT MCP connection.
// The registered connection id is supplied at build time, never stored in tracked source.
// Format: https://developers.openai.com/plugins/build/plugins
// Mapping: https://learn.chatgpt.com/docs/enterprise/plugin-management
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zip, type ZipEntry } from './zip.js';

/** ChatGPT URLs use plugin_asdk_app_…; .app.json requires the underlying asdk_app_… id. */
export function registeredAppId(value: string): string {
  const id = value.startsWith('plugin_asdk_app_') ? value.slice('plugin_'.length) : value;
  if (!/^(?:asdk_app|connector|templated_apps)_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
    throw new Error('Pass the registered MCP connection id (plugin_asdk_app_… or asdk_app_…), not a URL.');
  return id;
}

/** Contains only the manifest, connection mapping, license and generated skill; no local owner data. */
export function chatGptPlugin(repo: string, appId: string): Buffer {
  const id = registeredAppId(appId);
  const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')) as {
    version: string;
    license: string;
  };
  const skill = path.join(repo, 'skills', 'scaffold-tutor');
  if (!existsSync(path.join(skill, 'SKILL.md')))
    throw new Error('The generated scaffold-tutor skill is missing. Run npm run build:adapters first.');
  const manifest = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'scaffold-tutor',
    version: pkg.version,
    description: 'Evidence-based tutoring with Scaffold’s learner model, vault and Anki tools.',
    author: { name: 'Basam Ahmed' },
    repository: 'https://github.com/BasamAhmed640/scaffold',
    license: pkg.license,
    keywords: ['tutor', 'learning', 'obsidian', 'anki', 'spaced repetition'],
    extensions: {
      'com.openai': {
        apps: './.app.json',
        interface: {
          displayName: 'Scaffold Tutor',
          shortDescription: 'Study with Scaffold',
          longDescription:
            'Tutoring sessions, retrieval practice, visuals and approved Anki card proposals. Uses the registered Scaffold MCP connection to the learner’s local vault. Keep the computer and its MCP tunnel running; keep Anki open for immediate sync.',
          developerName: 'Basam Ahmed',
          category: 'Productivity',
          capabilities: ['Read', 'Write'],
          defaultPrompt: ['Start a session on a subject I want to study.'],
        },
      },
    },
  };
  const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const entries: ZipEntry[] = [
    { name: 'plugin.json', data: json(manifest) },
    { name: '.app.json', data: json({ apps: { scaffold: { id, required: true } } }) },
    { name: 'LICENSE', data: readFileSync(path.join(repo, 'LICENSE')) },
  ];
  const addSkill = (relative = ''): void => {
    const source = path.join(skill, relative);
    if (!lstatSync(source).isDirectory()) throw new Error(`Skill directory is not a directory: ${source}`);
    for (const name of readdirSync(source).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      const file = path.join(skill, rel);
      const stat = lstatSync(file);
      if (stat.isDirectory()) addSkill(rel);
      else if (stat.isFile())
        entries.push({ name: `skills/scaffold-tutor/${rel}`, data: readFileSync(file) });
      else throw new Error(`Skill contains an unsupported file: ${rel}`);
    }
  };
  addSkill();
  return zip(entries);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    console.log('Usage: npm run build:chatgpt -- --app-id plugin_asdk_app_…');
    console.log(
      'Writes dist/scaffold-chatgpt-plugin.zip using the generated skill and registered MCP connection.',
    );
    return;
  }
  if (args.length !== 2 || args[0] !== '--app-id')
    throw new Error('Usage: npm run build:chatgpt -- --app-id plugin_asdk_app_…');
  const repo = path.resolve('.');
  const archive = chatGptPlugin(repo, args[1]!);
  mkdirSync(path.join(repo, 'dist'), { recursive: true });
  const target = path.join(repo, 'dist', 'scaffold-chatgpt-plugin.zip');
  writeFileSync(target, archive);
  console.log(`Wrote ${target} (${archive.length} bytes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
