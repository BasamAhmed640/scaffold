import { z } from 'zod';
import {
  applyCardActions,
  ApplyActionsInput,
  flagCard,
  FlagCardInput,
  listCardActions,
  proposeCardActions,
  ProposeActionsInput,
  proposeCards,
  ProposeCardsInput,
} from '../service/anki/cards.js';
import { ankiStack, getAnkiLoad, setSubjectScope, SetScopeInput, StackInput } from '../service/anki/ops.js';
import { ankiSync } from '../service/anki/sync.js';
import type { ToolDef } from './tools.js';

// D8 Anki rows (ANK-01 … ANK-10). Card changes are proposals until apply_card_actions carries the
// learner's approval; nothing here deletes notes or decks (ANK-04).

const Empty = z.object({});

export const ANKI_TOOLS: ToolDef[] = [
  {
    name: 'anki_sync',
    title: 'Anki sync',
    description:
      'Syncs with AnkiConnect (ANK-08): replays queued operations once each, creates note types and subject decks, pulls cards and reviews (lapses, leeches), flags stale cards and proposes budget actions. Offline: reports the queue (ANK-09).',
    input: Empty,
    handler: (sc, _i, w) => ankiSync(sc, w),
  },
  {
    name: 'get_anki_load',
    title: 'Anki load',
    description:
      'Per subject and in total: measured (7-day) and estimated Anki minutes per day against budgets, active cards, yearly intake, recommended deck limits (ANK-01, ANK-06).',
    input: Empty,
    readOnly: true,
    handler: (sc) => getAnkiLoad(sc),
  },
  {
    name: 'propose_cards',
    title: 'Propose Anki cards',
    description:
      'Proposes cards for KCs retrieved correctly this session (TP-14), each with one-line answers to the three admission tests (ANK-03). Rejects violations of the caps (3 per KC, one anchor) and of the yearly intake budget. Nothing is added until apply_card_actions.',
    input: ProposeCardsInput,
    handler: (sc, i, w) => proposeCards(sc, i, w),
  },
  {
    name: 'propose_card_actions',
    title: 'Propose card changes',
    description:
      'Proposes rewrite, rewrite_reset, retire, dormant, unsuspend, pause_new, unpause_new, compress or keep for existing cards (ANK-04). Applied only after the learner approves.',
    input: ProposeActionsInput,
    handler: (sc, i, w) => proposeCardActions(sc, i, w),
  },
  {
    name: 'apply_card_actions',
    title: 'Apply approved card changes',
    description:
      'Only after the learner explicitly approves (TP-17): pass the action ids and their words. Adds, rewrites (resetting a card whose answer changed), suspends and tags; never deletes. A card edited in Anki since the proposal is not overwritten (ANK-08).',
    input: ApplyActionsInput,
    handler: (sc, i, w) => applyCardActions(sc, i, w),
  },
  {
    name: 'list_card_actions',
    title: 'List card actions',
    description: 'Card proposals and changes waiting for approval (or all, with pending_only false).',
    input: z.object({ pending_only: z.boolean().default(true) }),
    readOnly: true,
    handler: (sc, i) => listCardActions(sc, i),
  },
  {
    name: 'flag_card',
    title: 'Flag a card',
    description:
      'When a deep check, teach-back or explanation shows a linked card is wrong, outdated or oversimplified (TP-17): tags it scaffold::check (ANK-05) and records the proposed fix. Then propose_card_actions.',
    input: FlagCardInput,
    handler: (sc, i, w) => flagCard(sc, i, w),
  },
  {
    name: 'set_subject_scope',
    title: 'Set subject scope',
    description:
      'active | paused | closed (ANK-07). Pausing or closing proposes dormancy for non-anchor, unprotected cards; reopening proposes unsuspension and marks the KCs needs_check.',
    input: SetScopeInput,
    handler: (sc, i, w) => setSubjectScope(sc, i, w),
  },
  {
    name: 'anki_stack',
    title: 'Custom stack',
    description:
      'Search string for a filtered deck (ANK-01) by subject, KCs, tags or status (forgotten, fragile, misconception, check), with the cards it matches now.',
    input: StackInput,
    readOnly: true,
    handler: (sc, i) => ankiStack(sc, i),
  },
];
