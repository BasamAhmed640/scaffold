import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { callTool } from '../core/api/tools.js';
import { ScaffoldError } from '../core/envelope.js';
import type { CliContext } from './run.js';

// `scaffold anki …` and `scaffold scope set` (D8 Anki rows). Thin wrappers over the shared tools.

const collect = (v: string, prev: string[] = []): string[] => [...prev, v];

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ScaffoldError('invalid_json', `Could not read JSON from ${file}: ${(e as Error).message}`);
  }
}

export function ankiCommands(program: Command, ctx: CliContext): void {
  const anki = program
    .command('anki')
    .description('Anki: sync, load, proposals, card actions, flags, stacks (D7)');
  anki
    .command('sync')
    .description(
      'Sync with AnkiConnect: replay the queue, pull cards and reviews, flag, propose (ANK-08, ANK-09)',
    )
    .action(() => ctx.tool('anki sync', 'anki_sync', {}));
  anki
    .command('status')
    .description('Load per subject and in total, with recommended deck limits (ANK-01, ANK-06)')
    .action(() => ctx.tool('anki status', 'get_anki_load', {}));
  anki
    .command('load')
    .description('Same as status')
    .action(() => ctx.tool('anki status', 'get_anki_load', {}));
  anki
    .command('propose')
    .description('Propose cards from a JSON file ({cards: [...]}) with admission answers (ANK-03)')
    .requiredOption('--file <json>')
    .action((o: { file: string }) =>
      ctx.run('anki propose', (sc) => callTool(sc, 'propose_cards', readJson(o.file))),
    );
  const actions = anki.command('actions').description('Card actions waiting for approval (ANK-04)');
  actions
    .command('list')
    .option('--all', 'include applied and aborted actions')
    .action((o: { all?: boolean }) =>
      ctx.tool('anki actions list', 'list_card_actions', { pending_only: !o.all }),
    );
  actions
    .command('apply <ids...>')
    .description('Apply approved actions; --approval quotes the learner (required)')
    .requiredOption('--approval <words>', "the learner's explicit approval, verbatim")
    .action((ids: string[], o: { approval: string }) =>
      ctx.tool('anki actions apply', 'apply_card_actions', {
        action_ids: ids,
        approval: { learner_quote: o.approval },
      }),
    );
  anki
    .command('flag <noteId>')
    .description('Tag a card scaffold::check and record why (ANK-05)')
    .requiredOption('--detail <text>', 'what is wrong with it')
    .option('--propose <fix>', 'retire | rewrite | keep | check', 'check')
    .action((noteId: string, o: { detail: string; propose: string }) =>
      ctx.tool('anki flag', 'flag_card', {
        note_id: Number(noteId),
        detail: o.detail,
        proposed: o.propose,
        by: 'owner',
      }),
    );
  anki
    .command('stack <name>')
    .description('Search string for a filtered deck (ANK-01)')
    .option('--subject <subject>')
    .option('--kc <id>', 'KC id (repeatable)', collect, [])
    .option('--tag <tag>', 'tag (repeatable)', collect, [])
    .option('--status <status>', 'forgotten | fragile | misconception | check')
    .action((name: string, o: { subject?: string; kc: string[]; tag: string[]; status?: string }) =>
      ctx.tool('anki stack', 'anki_stack', {
        name,
        ...(o.subject ? { subject: o.subject } : {}),
        ...(o.kc.length ? { kc_ids: o.kc } : {}),
        ...(o.tag.length ? { tags: o.tag } : {}),
        ...(o.status ? { status: o.status } : {}),
      }),
    );
  program
    .command('scope')
    .description('Goal scope (ANK-07)')
    .command('set <subject> <scope>')
    .description('active | paused | closed; proposes the card changes it implies')
    .action((subject: string, scope: string) =>
      ctx.tool('scope set', 'set_subject_scope', { subject, scope }),
    );
}
