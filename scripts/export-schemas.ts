// IF-02: zod schemas are exported as JSON Schema into schemas/. `--check` fails if they are stale.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { allTools } from '../src/core/api/tools.js';
import { ConfigSchema } from '../src/core/config.js';
import { ScaffoldEvent } from '../src/core/schemas/events.js';
import { KcFields } from '../src/core/schemas/kc.js';
import { Question } from '../src/core/schemas/question.js';
import { SubjectFields } from '../src/core/schemas/subject.js';

const Envelope = z.object({
  ok: z.boolean(),
  data: z.unknown(),
  warnings: z.array(z.string()),
  errors: z.array(z.object({ code: z.string(), message: z.string(), next_step: z.string().optional() })),
});

export function schemaFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const put = (name: string, schema: z.ZodType): void => {
    files[name] =
      JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }), null, 2) + '\n';
  };
  put('envelope.schema.json', Envelope);
  put('event.schema.json', ScaffoldEvent);
  put('config.schema.json', ConfigSchema);
  put('concept.schema.json', KcFields);
  put('subject.schema.json', SubjectFields);
  put('question.schema.json', Question);
  for (const t of allTools()) put(`tools/${t.name}.input.schema.json`, t.input);
  return files;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, text] of Object.entries(schemaFiles())) {
  const file = path.join('schemas', rel);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text) {
      console.error(`stale: ${file}`);
      stale++;
    }
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
if (check && stale) {
  console.error(`${stale} schema file(s) are stale; run \`npm run schemas\`.`);
  process.exit(1);
}
console.log(
  check ? 'schemas are current' : `wrote ${Object.keys(schemaFiles()).length} schema files to schemas/`,
);
