import { ScaffoldError } from '../envelope.js';

// AnkiConnect over HTTP on the loopback interface only (IF-04). One attempt per call with a hard
// timeout (ANK-09: 2 s by default); when Anki does not answer, callers queue the operation.

export interface AnkiClient {
  invoke<T = unknown>(action: string, params?: Record<string, unknown>): Promise<T>;
}

/** AnkiConnect did not answer (closed, wrong port, timeout). The operation can be queued. */
export class AnkiOffline extends Error {
  constructor(
    readonly url: string,
    readonly why: string,
  ) {
    super(`AnkiConnect is not reachable at ${url} (${why}).`);
    this.name = 'AnkiOffline';
  }
}

/** AnkiConnect answered with an error for this action. Not retried, not queued. */
export class AnkiActionError extends Error {
  constructor(
    readonly action: string,
    message: string,
  ) {
    super(`${action}: ${message}`);
    this.name = 'AnkiActionError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** IF-04: the only network peer is AnkiConnect on this machine. */
export function assertLoopback(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ScaffoldError(
      'anki_url_invalid',
      `"${url}" is not a URL.`,
      'Set anki.url to http://127.0.0.1:8765.',
    );
  }
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname))
    throw new ScaffoldError(
      'anki_url_not_local',
      `anki.url must point at this machine (127.0.0.1); got ${u.host}.`,
      'Scaffold talks only to AnkiConnect on 127.0.0.1 (IF-04). Set anki.url to http://127.0.0.1:8765.',
    );
  return u;
}

export class AnkiConnectClient implements AnkiClient {
  private readonly url: string;
  constructor(
    url: string,
    private readonly timeoutMs = 2000,
    private readonly version = 6,
  ) {
    this.url = assertLoopback(url).toString();
  }

  async invoke<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let body: unknown;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, version: this.version, params }),
        signal: ctrl.signal,
      });
      body = await res.json();
    } catch (e) {
      const why = ctrl.signal.aborted ? `no answer within ${this.timeoutMs} ms` : (e as Error).message;
      throw new AnkiOffline(this.url, why);
    } finally {
      clearTimeout(timer);
    }
    const r = (body ?? {}) as { result?: unknown; error?: unknown };
    if (r.error !== null && r.error !== undefined) throw new AnkiActionError(action, String(r.error));
    return r.result as T;
  }
}
