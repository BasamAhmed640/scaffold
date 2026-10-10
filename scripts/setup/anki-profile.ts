// Adds a disposable "Scaffold Smoke" profile to Anki's prefs21.db while Anki is closed, the way
// Anki's ProfileManager.create does: a row (name, pickled profile defaults). No AnkiWeb key and sync
// off, so the profile can never sync anywhere. Used by scripts/setup/anki-smoke-profile.ps1.
//   npx tsx scripts/setup/anki-profile.ts <path to prefs21.db>
import { DatabaseSync } from 'node:sqlite';

export const SMOKE_PROFILE = 'Scaffold Smoke';

type Value = string | number | boolean | null | [];

/** Python pickle (protocol 2) of a flat dict of str / int / bool / None / [] values. */
export function pickle(dict: Record<string, Value>): Buffer {
  const parts: Buffer[] = [Buffer.from([0x80, 0x02, 0x7d, 0x28])]; // PROTO 2, EMPTY_DICT, MARK
  const str = (s: string): void => {
    const u = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(u.length);
    parts.push(Buffer.from([0x58]), len, u); // BINUNICODE
  };
  for (const [k, v] of Object.entries(dict)) {
    str(k);
    if (v === null)
      parts.push(Buffer.from([0x4e])); // NONE
    else if (v === true)
      parts.push(Buffer.from([0x88])); // NEWTRUE
    else if (v === false)
      parts.push(Buffer.from([0x89])); // NEWFALSE
    else if (Array.isArray(v))
      parts.push(Buffer.from([0x5d])); // EMPTY_LIST
    else if (typeof v === 'string') str(v);
    else if (Number.isInteger(v) && v >= 0 && v < 256)
      parts.push(Buffer.from([0x4b, v])); // BININT1
    else {
      const b = Buffer.alloc(5);
      b[0] = 0x4a; // BININT
      b.writeInt32LE(v, 1);
      parts.push(b);
    }
  }
  parts.push(Buffer.from([0x75, 0x2e])); // SETITEMS, STOP
  return Buffer.concat(parts);
}

/** Anki 26.9's profile defaults (aqt/profiles.py), with syncing off for a disposable profile. */
export function smokeProfile(now = new Date()): Record<string, Value> {
  return {
    mainWindowGeom: null,
    mainWindowState: null,
    numBackups: 50,
    lastOptimize: Math.floor(now.getTime() / 1000),
    searchHistory: [],
    syncKey: null,
    syncMedia: false,
    autoSync: false,
    allowHTML: false,
    importMode: 1,
    lastColour: '#00f',
    stripHTML: true,
    deleteMedia: false,
  };
}

function main(file: string | undefined): number {
  if (!file) {
    console.error('Usage: npx tsx scripts/setup/anki-profile.ts <path to prefs21.db>');
    return 2;
  }
  const db = new DatabaseSync(file);
  try {
    const exists = db.prepare('select 1 from profiles where name = ? collate nocase').get(SMOKE_PROFILE);
    if (exists) console.log(`Profile "${SMOKE_PROFILE}" already exists.`);
    else {
      db.prepare('insert or ignore into profiles values (?, ?)').run(SMOKE_PROFILE, pickle(smokeProfile()));
      console.log(`Added profile "${SMOKE_PROFILE}" (sync off, no AnkiWeb key).`);
    }
    const names = db.prepare("select name from profiles where name != '_global'").all() as { name: string }[];
    console.log(`Profiles: ${names.map((r) => r.name).join(', ')}`);
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/setup/anki-profile.ts'))
  process.exit(main(process.argv[2]));
