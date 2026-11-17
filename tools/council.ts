// `bun tools/council.ts [job id ...]`: has the council review the resume of each job not yet sent
// (or of the jobs named), rewriting any that fall short, and then gives each a six-second skim
// (lib/skim.ts; EGG_SKIM=off leaves it out). Two at a time. Backs the database up first.
// A resume the person edited by hand is left out unless its job is named, and is then only scored, never rewritten.
import { copyFileSync } from 'node:fs';
import { db } from '../lib/db.ts';
import { review, type Analysis, type JobRow } from '../lib/jobs.ts';
import { inData } from '../lib/paths.ts';

copyFileSync(inData('egg.db'), inData('egg.db.before-council'));
const ids = process.argv.slice(2).map(Number).filter(Boolean);
const queue = (db.query("SELECT * FROM jobs WHERE resume != '' AND posting != '' ORDER BY fit DESC").all() as JobRow[]).filter((j) => (ids.length ? ids.includes(j.id) : j.outcome === '' && j.edited !== 1));
console.log(`${queue.length} resumes to review`);
const next = async (): Promise<void> => {
  const job = queue.shift();
  if (!job) return;
  try {
    const r = await review(job);
    if (!r) { console.log(`job ${job.id} (${job.company}): the rewrite named a job your bank does not have, so the resume was kept as it was`); return next(); }
    const skim = (JSON.parse((db.query('SELECT analysis FROM jobs WHERE id = ?').get(job.id) as { analysis: string }).analysis) as Analysis).skim;
    console.log(`job ${job.id} (${job.company}): ${r.score}/10 after ${r.rounds} ${r.rounds === 1 ? 'rewrite' : 'rewrites'}${r.passed ? '' : ', short of 8'}${skim ? `; skim: ${skim.top.filter((t) => t.answered).length} of ${skim.top.length} top requirements answered, ${skim.questions.length} questions for you` : ''}`);
  } catch (e) { console.log(`job ${job.id} (${job.company}) failed: ${(e as Error).message}`); }
  return next();
};
await Promise.all([next(), next()]);
