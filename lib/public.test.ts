// `bun test lib`: the public collection's draft, notes and saved file. Every test works in a scratch
// folder with a scratch database of an invented person; the real data folder is never opened.
import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftCollection, MAX_COLLECTION, readSaved, reviewNotes, saveCollection } from './public.ts';

const scratch = mkdtempSync(join(tmpdir(), 'egg-public-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const folder = () => join(scratch, `case-${++n}`, 'public');
const hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// Only the columns the draft reads, filled with an invented person.
function bank() {
  const d = new Database(':memory:');
  d.run("CREATE TABLE roles (id INTEGER PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, start TEXT NOT NULL DEFAULT '', end TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', standing TEXT NOT NULL DEFAULT '', part_of INTEGER)");
  d.run("CREATE TABLE facts (id INTEGER PRIMARY KEY, role_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', metric TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '')");
  d.run("CREATE TABLE profile (id INTEGER PRIMARY KEY, body TEXT NOT NULL DEFAULT '')");
  d.run("INSERT INTO roles (id, company, title, start, summary) VALUES (1, 'Northwind Widgets', 'Staff Engineer', '2020-04', 'Led the  build team.')");
  d.run("INSERT INTO roles (id, company, title, start, part_of) VALUES (2, 'widget-api', '', '2021-01', 1)");
  d.run("INSERT INTO facts (role_id, kind, text, metric) VALUES (1, 'accomplishment', 'Cut build times by 40%.', 'From 20 to 12 minutes')");
  d.run("INSERT INTO facts (role_id, kind, text) VALUES (2, 'project', 'Wrote the widget API.')");
  d.run("INSERT INTO facts (role_id, kind, text) VALUES (NULL, 'education', 'BSc in Computer Science.')");
  d.run("INSERT INTO profile (id, body) VALUES (1, '# Overview\n\nA builder of tools.')");
  return d;
}

test('the draft is the bank as Markdown, and making it saves nothing', () => {
  const dir = folder();
  const text = draftCollection(bank());
  expect(text).toBe([
    '# Public collection', '',
    '## Staff Engineer, Northwind Widgets (2020-04 to now)', '', 'Led the build team.', '',
    '### What was delivered', '', '- Cut build times by 40%. Measured: From 20 to 12 minutes', '',
    '### Project: widget-api (2021-01 to now)', '', '#### Projects', '', '- Wrote the widget API.', '',
    '## Not tied to one role', '', '### Education', '', '- BSc in Computer Science.', '',
    '## Overview, from the profile', '', '### Overview', '', 'A builder of tools.', '', '',
  ].join('\n'));
  expect(existsSync(join(dir, 'collection.md'))).toBe(false);
  expect(readSaved(dir)).toEqual({ text: '', savedAt: null, sha256: null });
});

test('each kind of note is found, on the right line', () => {
  const text = [
    '# Heading with a client is skipped',
    '- Grew revenue by $3m.',
    '',
    'Served 12,000 users at 99% uptime.',
    '- Worked with the CEO and a partner.',
    'Docs at https://widgets.example.org.',
    '- Ran the internal incident review.',
    '- Wrote the widget API.',
  ].join('\n');
  const found = reviewNotes(text).map((x) => [x.line, x.kind]);
  expect(found).toEqual([
    [2, 'money'],
    [4, 'a percentage or a count'],
    [5, 'a person, client or partner'],
    [6, 'a link or an address'],
    [7, 'inside knowledge'],
  ]);
  expect(reviewNotes(text)[0].text).toBe('- Grew revenue by $3m.');
});

test('one line can carry several notes, and a long line is cut to 200 characters', () => {
  const long = `- A client paid $5m for it. ${'x'.repeat(400)}`;
  const notes = reviewNotes(`intro\r\n${long}`);
  expect(notes.map((x) => x.kind)).toEqual(['money', 'a person, client or partner']);
  expect(notes.every((x) => x.line === 2 && x.text.length === 200 && x.text === long.slice(0, 200))).toBe(true);
  expect(reviewNotes('')).toEqual([]);
});

test('a saved collection reads back with its time and SHA-256', () => {
  const dir = folder();
  const before = Date.now();
  const saved = saveCollection('# Public collection\n\n- Wrote the widget API.\n', dir);
  const read = readSaved(dir);
  expect(read.text).toBe('# Public collection\n\n- Wrote the widget API.\n');
  expect(read.sha256).toBe(hex(read.text));
  expect(read.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(saved).toEqual({ savedAt: read.savedAt!, sha256: read.sha256! });
  expect(read.savedAt!).toBeGreaterThanOrEqual(before - 2000);
  // Only the collection is left in the folder: the temporary file was moved over it.
  expect(readdirSync(dir)).toEqual(['collection.md']);
});

test('line endings become \\n and the text ends with exactly one \\n', () => {
  const dir = folder();
  saveCollection('one\r\ntwo\rthree', dir);
  expect(readFileSync(join(dir, 'collection.md'), 'utf8')).toBe('one\ntwo\nthree\n');
  saveCollection('café ✓\n\n\n\n', dir);
  const read = readSaved(dir);
  expect(read.text).toBe('café ✓\n');
  expect(read.sha256).toBe(hex('café ✓\n'));
});

test('empty and too-long text is refused, and the saved file is left as it was', () => {
  const dir = folder();
  saveCollection('kept', dir);
  for (const bad of ['', '   \n\t\r\n']) expect(() => saveCollection(bad, dir)).toThrow(/empty/);
  expect(() => saveCollection('a'.repeat(MAX_COLLECTION + 1), dir)).toThrow(/120,000 characters/);
  expect(readSaved(dir).text).toBe('kept\n');
  expect(() => saveCollection('a'.repeat(MAX_COLLECTION - 1), dir)).not.toThrow();
});

test('no saved file reads as empty', () => {
  expect(readSaved(folder())).toEqual({ text: '', savedAt: null, sha256: null });
});
