// `bun tools/public.ts`: writes a draft of the public collection, the only material a public
// assistant may answer from. The draft is the whole bank as plain Markdown: each role with its
// facts, then the facts that belong to no role, then the profile. No model writes it, so it says
// only what the bank says. The work is done in lib/public.ts, which the app's server uses too.
//
// Nothing here publishes. The draft goes to .data/public/collection.draft.md, which git ignores.
// The person reads it, deletes whatever must not be public, and saves the result beside it as
// collection.md (or in the app). Only that file is ever shipped, and this command never writes it.
// A second file, collection.review.md, lists the draft's lines that deserve a second look: money,
// percentages and counts, people and clients, links and addresses, words such as "internal".
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../lib/db.ts';
import { inData } from '../lib/paths.ts';
import { draftCollection, reviewNotes, SAVED, type Note } from '../lib/public.ts';

const count = (table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const draft = draftCollection(db);

// One review line for each draft line with notes, its reasons joined.
const byLine = new Map<number, Note[]>();
for (const n of reviewNotes(draft)) byLine.set(n.line, [...(byLine.get(n.line) ?? []), n]);
const review: string[] = ['# Lines to look at twice', '', 'Each line of the draft that matched a check, with the reason. A match is a prompt to look, not a finding.', ''];
for (const [line, notes] of byLine) review.push(`- Line ${line} (${notes.map((n) => n.kind).join('; ')}): ${notes[0].text.replace(/^- /, '')}`);

const dir = inData('public');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'collection.draft.md'), draft);
writeFileSync(join(dir, 'collection.review.md'), `${review.join('\n')}\n`);
console.log(`draft: ${join(dir, 'collection.draft.md')} (${count('roles')} roles, ${count('facts')} facts, ${draft.length.toLocaleString('en-US')} characters)`);
console.log(`look twice: ${join(dir, 'collection.review.md')} (${byLine.size} lines)`);
console.log(existsSync(join(dir, SAVED))
  ? 'collection.md, the approved file, is there and was not touched.'
  : 'Nothing is public yet. Edit the draft and save what may be public as collection.md in the same folder.');
