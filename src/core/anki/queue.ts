import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// ANK-09: when AnkiConnect does not answer, operations are queued in Scaffold/_system/queue/ and
// replayed exactly once later: a file is renamed to *.done only after Anki confirmed it.

export const QueuedOp = z.object({
  op_id: z.string(),
  created: z.string(),
  action: z.string(),
  params: z.record(z.string(), z.unknown()),
  /** Why it was queued and what it belongs to (card action id, subject…). */
  context: z.record(z.string(), z.unknown()).default({}),
});
export type QueuedOp = z.infer<typeof QueuedOp>;

export class OpQueue {
  constructor(readonly dir: string) {}

  private ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  /** Pending ops in creation order (file names sort by sequence). */
  pending(): { file: string; op: QueuedOp }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ({
        file: path.join(this.dir, f),
        op: QueuedOp.parse(JSON.parse(readFileSync(path.join(this.dir, f), 'utf8'))),
      }));
  }

  enqueue(op: QueuedOp): string {
    this.ensure();
    const seq = String(Date.now()).padStart(15, '0');
    const n = this.pending().length + readdirSync(this.dir).filter((f) => f.endsWith('.done')).length;
    const file = path.join(this.dir, `${seq}-${String(n).padStart(5, '0')}-${op.op_id}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(op, null, 2));
    renameSync(tmp, file);
    return file;
  }

  markDone(file: string): void {
    renameSync(file, file.replace(/\.json$/, '.done'));
  }

  count(): number {
    return this.pending().length;
  }
}
