// `bun tools/questions.ts`: closes the open questions that the bank or the Talk conversation already
// answers, whatever their wording. The worker does this after each profile and each job reading.
import { prune, openQuestions } from '../lib/talk.ts';
import { inData } from '../lib/paths.ts';

const before = openQuestions(200).length;
const n = await prune(inData('inbox'));
console.log(`${before} open, ${n} closed as already answered, ${openQuestions(200).length} left`);
for (const q of openQuestions(200)) console.log(`- ${q.text}`);
