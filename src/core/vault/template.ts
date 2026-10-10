import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KcFields } from '../schemas/kc.js';
import { SubjectFields } from '../schemas/subject.js';
import { conceptNote, homeNote, misconceptionsLedgerNote, profileNote, subjectNote } from './notes.js';

// Generated files of vault-template/Scaffold/. `npm run build:template` writes them; a test checks
// that the committed copies match these generators (no drift).

export function generatedTemplateFiles(): Record<string, string> {
  const kc = KcFields.parse({ id: 'kc-template', title: '{{title}}', subject: 'subject-id' });
  const subject = SubjectFields.parse({
    id: 'subject-id',
    title: '{{title}}',
    anki_deck: 'Scaffold::{{title}}',
  });
  return {
    'Home.md': homeNote(),
    'Learner/Profile.md': profileNote(),
    'Learner/Misconceptions.md': misconceptionsLedgerNote(),
    '_templates/Concept.md': conceptNote(kc).replace('id: kc-template', 'id: kc-{{subject}}-{{slug}}'),
    '_templates/Subject.md': subjectNote(subject),
  };
}

/** Locates the packaged vault-template/ folder (works from src/ under tsx and from dist/). */
export function templateRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../vault-template'),
    path.resolve(here, '../../vault-template'),
    path.resolve(here, '../vault-template'),
  ];
  for (const c of candidates) if (existsSync(path.join(c, 'Scaffold'))) return c;
  return candidates[0]!;
}
