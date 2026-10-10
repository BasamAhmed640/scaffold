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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  if (check && existsSync(STATE)) root = (JSON.parse(readFileSync(STATE, 'utf8')) as { root: string }).root;
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
      concepts: [1, 2, 3].map((i) => ({ id: `kc-smoke-${i}`, title: `Smoke fact ${i}`, subject: 'smoke' })),
    });
    await call('start_session', { focus: 'smoke', minutes: 10 });
    for (const i of [1, 2, 3]) {
      await call('mark_taught', { kc_ids: [`kc-smoke-${i}`] });
      await call('record_attempt', {
        question_text: `Smoke question ${i}?`,
        kc_ids: [`kc-smoke-${i}`],
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
        kc_id: `kc-smoke-${i}`,
        front: `Smoke front ${i}`,
        back: `Smoke back ${i}`,
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
    writeFileSync(STATE, JSON.stringify({ root }));
    const cards = await client.invoke<number[]>('findCards', { query: 'tag:kc::kc-smoke-1' });
    save('cardsInfo', await client.invoke('cardsInfo', { cards }));
    if (!actions.includes('answerCards')) {
      console.log(
        'AnkiConnect has no answerCards. In Anki, study "Scaffold::Smoke": answer every card Easy, then',
      );
      console.log('use Browse → Set Due Date "0" on "Smoke front 1", study it and answer Again. Then run:');
      console.log('  npx tsx scripts/anki-smoke.ts --check');
      return 0;
    }
    const all = await client.invoke<number[]>('findCards', { query: 'deck:"Scaffold::Smoke"' });
    await client.invoke('answerCards', { answers: all.map((cardId) => ({ cardId, ease: 4 })) }); // graduate to review
    await client.invoke('answerCards', { answers: [{ cardId: cards[0], ease: 1 }] }); // a lapse on the anchor
  }
  const cards = await client.invoke<number[]>('findCards', { query: 'tag:kc::kc-smoke-1' });
  save('revlog', await client.invoke('getReviewsOfCards', { cards: cards.map(String) }));
  const sync = await call('anki_sync', {});
  save('sync-2', sync);
  const s = sc();
  const imported = s.events().filter((e) => e.type === 'anki_reviews_imported');
  const lapse = imported.some(
    (e) =>
      e.type === 'anki_reviews_imported' && e.reviews.some((r) => r.lapse && r.kc_ids.includes('kc-smoke-1')),
  );
  const status = s.derived().kcs['kc-smoke-1']?.status;
  console.log(
    `AnkiConnect ${version}; reviews imported: ${imported.reduce((a, e) => a + (e.type === 'anki_reviews_imported' ? e.reviews.length : 0), 0)}; anchor lapse event: ${lapse}; kc-smoke-1 status: ${status}`,
  );
  console.log(`Raw responses: ${OUT}`);
  const ok = lapse && status === 'forgotten';
  console.log(ok ? 'PASS: lapses produce events and status changes.' : 'FAIL: see the raw responses.');
  return ok ? 0 : 1;
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error((e as Error).message);
    process.exit(2);
  },
);
