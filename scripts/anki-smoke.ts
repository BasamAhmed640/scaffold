// V-ANKI live smoke test, run by the owner on a disposable Anki profile (never the real one).
//
//   1. In Anki: File → Switch Profile → Add → "Scaffold Smoke"; open it; AnkiConnect installed.
//   2. npx tsx scripts/anki-smoke.ts
//
// It refuses to run unless the active profile is "Scaffold Smoke". It creates a temporary vault,
// adds 3 notes through the normal proposal → approval path, reviews them (answerCards when
// apiReflect lists it, otherwise it prints what to review by hand and exits; run it again with
// --check), syncs, and confirms that an anchor lapse produces an event and a status change. Raw
// AnkiConnect responses are saved to local/anki-smoke/ to confirm field names (ANK-01, ANK-08).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AnkiConnectClient } from '../src/core/anki/client.js';
import { callTool } from '../src/core/api/tools.js';
import { Scaffold } from '../src/core/service/scaffold.js';
import { systemClock } from '../src/core/time.js';
import { initVault } from '../src/core/vault/init.js';

const PROFILE = 'Scaffold Smoke';
const OUT = path.resolve('local', 'anki-smoke');
const STATE = path.join(OUT, 'state.json');

async function main(): Promise<number> {
  const client = new AnkiConnectClient(process.env.SCAFFOLD_ANKI_URL ?? 'http://127.0.0.1:8765', 5000, 6);
  const version = await client.invoke<number>('version');
  const actions = (
    await client.invoke<{ actions: string[] }>('apiReflect', { scopes: ['actions'], actions: null })
  ).actions;
  const profile = actions.includes('getActiveProfile')
    ? await client.invoke<string>('getActiveProfile')
    : null;
  if (profile !== PROFILE) {
    console.error(
      `Refusing to run: the active Anki profile is ${profile === null ? 'unknown' : `"${profile}"`}, not "${PROFILE}". Create and open a disposable "${PROFILE}" profile first.`,
    );
    return 2;
  }
  mkdirSync(OUT, { recursive: true });
  const save = (name: string, data: unknown): void =>
    writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
  save('reflect', { version, actions });

  const check = process.argv.includes('--check');
  let root: string;
  // A stamp per run keeps KC tags and card text apart from earlier runs in the same disposable
  // collection (Scaffold never deletes notes, ANK-04).
  let run = Date.now().toString(36);
  if (check && existsSync(STATE))
    ({ root, run } = JSON.parse(readFileSync(STATE, 'utf8')) as { root: string; run: string });
  else {
    root = path.join(mkdtempSync(path.join(tmpdir(), 'scaffold-smoke-')), 'Smoke Vault');
    initVault(root, { userConfig: path.join(OUT, 'user-config.json') });
  }
  const sc = (): Scaffold => Scaffold.open(root, { clock: systemClock });
  const call = async (tool: string, input: unknown): Promise<Record<string, unknown>> => {
    const r = await callTool(sc(), tool, input);
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.errors)}`);
    return r.data as Record<string, unknown>;
  };

  if (!check) {
    await call('upsert_subject', { title: 'Smoke', id: 'smoke' });
    await call('upsert_concept', {
      concepts: [1, 2, 3].map((i) => ({
        id: `kc-smoke-${run}-${i}`,
        title: `Smoke fact ${i}`,
        subject: 'smoke',
      })),
    });
    await call('start_session', { focus: 'smoke', minutes: 10 });
    for (const i of [1, 2, 3]) {
      await call('mark_taught', { kc_ids: [`kc-smoke-${run}-${i}`] });
      await call('record_attempt', {
        question_text: `Smoke question ${i} (${run})?`,
        kc_ids: [`kc-smoke-${run}-${i}`],
        answer_verbatim: `answer ${i}`,
        grade: 'correct',
        rubric_hits: [],
        evidence_quotes: [`answer ${i}`],
        confidence: 3,
        grader: 'smoke-test',
      });
    }
    const p = await call('propose_cards', {
      cards: [1, 2, 3].map((i) => ({
        kc_id: `kc-smoke-${run}-${i}`,
        front: `Smoke front ${i} (${run})`,
        back: `Smoke back ${i} (${run})`,
        anchor: true,
        admission: { rederive: 'smoke test', instant: 'smoke test', worth: 'smoke test' },
      })),
    });
    const ids = (p.proposals as { action_id: string }[]).map((x) => x.action_id);
    const applied = await call('apply_card_actions', {
      action_ids: ids,
      approval: { learner_quote: 'smoke test approval' },
    });
    save('applied', applied);
    save('sync-1', await call('anki_sync', {}));
    writeFileSync(STATE, JSON.stringify({ root, run }));
    const cards = await client.invoke<number[]>('findCards', { query: `tag:kc::kc-smoke-${run}-1` });
    save('cardsInfo', await client.invoke('cardsInfo', { cards }));
    if (!actions.includes('answerCards')) {
      console.log(
        'AnkiConnect has no answerCards. In Anki, study "Scaffold::Smoke": answer every card Easy, then',
      );
      console.log(
        `use Browse → Set Due Date "0" on "Smoke front 1 (${run})", study it and answer Again. Then run:`,
      );
      console.log('  npx tsx scripts/anki-smoke.ts --check');
      return 0;
    }
    const all = await client.invoke<number[]>('findCards', { query: 'deck:"Scaffold::Smoke"' });
    await client.invoke('answerCards', { answers: all.map((cardId) => ({ cardId, ease: 4 })) }); // graduate to review
    await client.invoke('answerCards', { answers: [{ cardId: cards[0], ease: 1 }] }); // a lapse on the anchor
  }
  const cards = await client.invoke<number[]>('findCards', { query: `tag:kc::kc-smoke-${run}-1` });
  save('revlog', await client.invoke('getReviewsOfCards', { cards }));
  const sync = await call('anki_sync', {});
  save('sync-2', sync);
  const s = sc();
  const imported = s.events().filter((e) => e.type === 'anki_reviews_imported');
  const lapse = imported.some(
    (e) =>
      e.type === 'anki_reviews_imported' &&
      e.reviews.some((r) => r.lapse && r.kc_ids.includes(`kc-smoke-${run}-1`)),
  );
  const status = s.derived().kcs[`kc-smoke-${run}-1`]?.status;
  console.log(
    `AnkiConnect ${version}; reviews imported: ${imported.reduce((a, e) => a + (e.type === 'anki_reviews_imported' ? e.reviews.length : 0), 0)}; anchor lapse event: ${lapse}; kc-smoke-1 status: ${status}`,
  );
  console.log(`Raw responses: ${OUT}`);
  const ok = lapse && status === 'forgotten';
  console.log(ok ? 'PASS: lapses produce events and status changes.' : 'FAIL: see the raw responses.');
  return ok ? 0 : 1;
}

// ---- ANK-09 live offline queue: `--queue` (closes Anki, queues 3 changes), then reopen Anki on the
// smoke profile and run `--replay` (one sync applies each change exactly once). Uses the vault of the
// last full run (state.json).

interface QueueState {
  root: string;
  run: string;
  subject_deck?: string;
  flagged?: number;
  retired?: number;
  retired_card?: number;
  action_id?: string;
}

const readState = (): QueueState => {
  if (!existsSync(STATE)) throw new Error('Run the smoke test once first (npx tsx scripts/anki-smoke.ts).');
  return JSON.parse(readFileSync(STATE, 'utf8')) as QueueState;
};

async function smokeProfileOpen(client: AnkiConnectClient): Promise<boolean> {
  const profile = await client.invoke<string>('getActiveProfile');
  if (profile !== PROFILE)
    throw new Error(`Refusing: the active Anki profile is "${profile}", not "${PROFILE}".`);
  return true;
}

async function queueOffline(): Promise<number> {
  const client = new AnkiConnectClient(process.env.SCAFFOLD_ANKI_URL ?? 'http://127.0.0.1:8765', 5000, 6);
  const state = readState();
  const sc = (): Scaffold => Scaffold.open(state.root, { clock: systemClock });
  // close Anki through AnkiConnect, only on the smoke profile, and wait until it stops answering
  let open = true;
  try {
    await smokeProfileOpen(client);
    await client.invoke('guiExitAnki');
  } catch (e) {
    if ((e as Error).message.startsWith('Refusing')) throw e;
    open = false;
  }
  for (let i = 0; open && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    // AnkiConnect's guiExitAnki keeps its QTimer in a local variable, which can be garbage-collected
    // before it fires (seen on 2026-10-10). After 5 s, close the window the way the ✕ button does.
    if (i === 5 && process.platform === 'win32')
      spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        'Get-Process anki | ForEach-Object { [void]$_.CloseMainWindow() }',
      ]);
    try {
      await client.invoke('version');
    } catch {
      open = false;
    }
  }
  if (open) throw new Error('Anki did not close within 30 s.');
  const notes = Object.values(sc().facts().card_actions)
    .flatMap((a) => a.created_note_ids ?? [])
    .sort((a, b) => a - b);
  if (notes.length < 2) throw new Error('The smoke vault has fewer than 2 notes in Anki.');
  const call = async (tool: string, input: unknown): Promise<Record<string, unknown>> => {
    const r = await callTool(sc(), tool, input);
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.errors)}`);
    return r.data as Record<string, unknown>;
  };
  const subject = await call('upsert_subject', {
    title: `Smoke queue ${state.run}`,
    id: `smoke-queue-${state.run}`,
  });
  const flag = await call('flag_card', {
    note_id: notes[0],
    detail: 'smoke: offline flag',
    proposed: 'check',
  });
  const proposed = await call('propose_card_actions', {
    actions: [
      { kind: 'retire', note_ids: [notes[1]], reason: 'smoke: offline retire', retire_reason: 'superseded' },
    ],
  });
  const actionId = (proposed.actions as { action_id: string }[])[0]!.action_id;
  const applied = await call('apply_card_actions', {
    action_ids: [actionId],
    approval: { learner_quote: 'smoke test approval (offline)' },
  });
  const queued = readdirSync(path.join(state.root, 'Scaffold', '_system', 'queue')).filter((f) =>
    f.endsWith('.json'),
  );
  const results = {
    subject: (subject.anki_deck as { status: string }).status,
    flag: flag.tag,
    apply: (applied.results as { result: string }[])[0]!.result,
    queued_files: queued.length,
  };
  writeFileSync(path.join(OUT, 'queue-offline.json'), JSON.stringify(results, null, 2));
  writeFileSync(
    STATE,
    JSON.stringify({
      ...state,
      subject_deck: `Scaffold::Smoke queue ${state.run}`,
      flagged: notes[0],
      retired: notes[1],
      action_id: actionId,
    }),
  );
  console.log(`Anki closed; queued while offline: ${JSON.stringify(results)}`);
  const ok =
    results.subject === 'queued' &&
    results.flag === 'queued' &&
    results.apply === 'queued' &&
    queued.length >= 3;
  console.log(
    ok
      ? 'Queued. Reopen Anki on "Scaffold Smoke", then run: npx tsx scripts/anki-smoke.ts --replay'
      : 'FAIL: not everything was queued.',
  );
  return ok ? 0 : 1;
}

async function replayOnline(): Promise<number> {
  const client = new AnkiConnectClient(process.env.SCAFFOLD_ANKI_URL ?? 'http://127.0.0.1:8765', 5000, 6);
  await smokeProfileOpen(client);
  const state = readState();
  const sc = (): Scaffold => Scaffold.open(state.root, { clock: systemClock });
  const first = await callTool(sc(), 'anki_sync', {});
  const second = await callTool(sc(), 'anki_sync', {});
  const r1 = (first.data as { replayed: Record<string, number> }).replayed;
  const r2 = (second.data as { replayed: Record<string, number> }).replayed;
  const decks = await client.invoke<string[]>('deckNames');
  const info = await client.invoke<{ noteId: number; tags: string[] }[]>('notesInfo', {
    notes: [state.flagged, state.retired],
  });
  const cards = await client.invoke<number[]>('findCards', { query: `nid:${state.retired}` });
  const suspended = await client.invoke<boolean[]>('areSuspended', { cards });
  const action = sc().facts().card_actions[state.action_id!];
  const checks = {
    replayed_first_sync: r1,
    replayed_second_sync: r2,
    deck_created: decks.includes(state.subject_deck!),
    flag_tag: info[0]!.tags.includes('scaffold::check'),
    retired_tag: info[1]!.tags.includes('retired::superseded'),
    retired_suspended: suspended.length > 0 && suspended.every(Boolean),
    action_recorded_applied: action?.result === 'applied',
  };
  writeFileSync(path.join(OUT, 'queue-replay.json'), JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(checks, null, 2));
  const ok =
    (r1.applied ?? 0) >= 3 &&
    r1.failed === 0 &&
    r1.still_queued === 0 &&
    (r2.applied ?? 0) === 0 &&
    checks.deck_created &&
    checks.flag_tag &&
    checks.retired_tag &&
    checks.retired_suspended &&
    checks.action_recorded_applied;
  console.log(
    ok ? 'PASS: each queued change applied exactly once (ANK-09).' : 'FAIL: see queue-replay.json.',
  );
  return ok ? 0 : 1;
}

(process.argv.includes('--queue')
  ? queueOffline()
  : process.argv.includes('--replay')
    ? replayOnline()
    : main()
).then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error((e as Error).message);
    process.exit(2);
  },
);
