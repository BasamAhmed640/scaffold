import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { deriveState } from '../../src/core/model/derive.js';
import type { LearnerFacts } from '../../src/core/model/facts.js';
import { applyEvent, emptyFacts, rebuild } from '../../src/core/model/reducer.js';
import { parseEvent } from '../../src/core/schemas/events.js';
import { TZ } from '../helpers/builder.js';
import { buildLog, randomLogSpec } from '../helpers/random-log.js';

// V-CORE / ARC-08: for 1,000 random event sequences, rebuild(events) equals the incrementally
// built state (facts persisted as JSON and reloaded after every event, as the live system does).

describe('ARC-08 rebuild determinism', () => {
  it('rebuild(events) equals the incrementally built state (1,000 random logs)', () => {
    const cfg = defaultConfig();
    fc.assert(
      fc.property(randomLogSpec, (spec) => {
        const b = buildLog(spec);
        const full = rebuild(b.events);
        let persisted = JSON.stringify(emptyFacts());
        for (const e of b.events) {
          const reloaded = JSON.parse(persisted) as LearnerFacts;
          // events are re-read from the JSONL line, as on disk
          applyEvent(reloaded, parseEvent(JSON.parse(JSON.stringify(e))));
          persisted = JSON.stringify(reloaded);
        }
        expect(persisted).toBe(JSON.stringify(full));
        const now = new Date(b.t + 3 * 86_400_000);
        const d1 = deriveState(full, cfg, now, { timezone: TZ });
        const d2 = deriveState(JSON.parse(persisted) as LearnerFacts, cfg, now, { timezone: TZ });
        expect(JSON.stringify(d2)).toBe(JSON.stringify(d1));
      }),
      { numRuns: 1000, seed: 20261009 },
    );
  });
});
