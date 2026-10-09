// IF-02: every call returns {ok, data, warnings[], errors[]}.

export interface ScaffoldIssue {
  code: string;
  message: string;
  /** One actionable next step (REL-03: one line plus a next step). */
  next_step?: string;
}

export interface Envelope<T> {
  ok: boolean;
  data: T | null;
  warnings: string[];
  errors: ScaffoldIssue[];
}

export class ScaffoldError extends Error {
  readonly code: string;
  readonly next_step: string | undefined;
  constructor(code: string, message: string, next_step?: string) {
    super(message);
    this.code = code;
    this.next_step = next_step;
  }
  toIssue(): ScaffoldIssue {
    return this.next_step
      ? { code: this.code, message: this.message, next_step: this.next_step }
      : { code: this.code, message: this.message };
  }
}

export function ok<T>(data: T, warnings: string[] = []): Envelope<T> {
  return { ok: true, data, warnings, errors: [] };
}

export function fail<T = never>(
  issue: ScaffoldIssue | ScaffoldIssue[],
  warnings: string[] = [],
): Envelope<T> {
  return { ok: false, data: null, warnings, errors: Array.isArray(issue) ? issue : [issue] };
}

/** Warnings collector passed through operations. */
export class Warnings {
  readonly items: string[] = [];
  add(message: string): void {
    if (!this.items.includes(message)) this.items.push(message);
  }
}

/** Runs fn and converts thrown errors into a failed envelope (never throws, never hangs: ARC-10). */
export async function guard<T>(fn: (w: Warnings) => Promise<T> | T): Promise<Envelope<T>> {
  const w = new Warnings();
  try {
    const data = await fn(w);
    return ok(data, w.items);
  } catch (err) {
    if (err instanceof ScaffoldError) return fail(err.toIssue(), w.items);
    if (isZodError(err)) {
      return fail(
        {
          code: 'invalid_input',
          message: err.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; '),
          next_step: 'Fix the listed fields and call again.',
        },
        w.items,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail(
      { code: 'internal_error', message, next_step: 'Run `scaffold doctor` and report the message.' },
      w.items,
    );
  }
}

interface ZodLikeError {
  issues: { path: PropertyKey[]; message: string }[];
}
function isZodError(err: unknown): err is ZodLikeError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ZodError' &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}
