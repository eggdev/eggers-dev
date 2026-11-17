// The person's own details: the name and contact line every resume opens with, and where they
// live. Entered by them (Profile, Your Details) and never taken from a model: a resume's first
// lines are written here, from this, so an old address in a supplied resume cannot come back.
import { db } from './db.ts';

export const FIELDS = ['name', 'location', 'email', 'phone', 'website', 'github', 'linkedin'] as const;
export type Person = Record<(typeof FIELDS)[number], string>;

db.run(`CREATE TABLE IF NOT EXISTS person (id INTEGER PRIMARY KEY CHECK (id = 1), ${FIELDS.map((f) => `${f} TEXT NOT NULL DEFAULT ''`).join(', ')}, updated_at INTEGER NOT NULL DEFAULT 0)`);
db.run('INSERT OR IGNORE INTO person (id) VALUES (1)');

export const person = () => db.query(`SELECT ${FIELDS.join(', ')} FROM person WHERE id = 1`).get() as Person;
export function savePerson(p: Partial<Person>, now: number) {
  const next = { ...person(), ...p };
  db.query(`UPDATE person SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = 1`).run(...FIELDS.map((f) => String(next[f] ?? '').trim()), now);
}

// A web address as it reads on a resume: no scheme, no trailing slash.
const bare = (s: string) => s.trim().replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
// A phone number as a resume prints it. A ten-digit North American number, with or without a leading 1, is
// written (XXX) XXX-XXXX. Any other number (one that starts with "+" and another country's code, or one of
// another length) is printed as it was entered.
export function phoneText(phone: string): string {
  const typed = phone.trim(), digits = typed.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  // Not North American: the wrong count of digits, an area code that starts with 0 or 1, letters (an extension), or "+" with another country's code.
  if (ten.length !== 10 || !/^[2-9]/.test(ten) || /[a-z]/i.test(typed) || (typed.startsWith('+') && digits.length !== 11)) return typed;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
export function contactLine(p = person()): string {
  return [p.location.trim(), p.email.trim(), phoneText(p.phone), bare(p.website), bare(p.github), bare(p.linkedin)].filter(Boolean).join(' · ');
}

// Puts the person's name and contact line at the top of a resume, in place of whatever stands
// before its first section. With no name entered, the resume is left as it was written.
export function withHeader(resume: string, p = person()): string {
  if (p.name.trim() === '') return resume;
  const lines = resume.trim().split('\n'), at = lines.findIndex((l) => /^##\s/.test(l));
  const rest = at < 0 ? lines.filter((l) => !/^#\s/.test(l)) : lines.slice(at);
  return [`# ${p.name.trim()}`, contactLine(p), '', ...rest].filter((l, i) => i !== 1 || l !== '').join('\n');
}

// Reads a name and contact line off the top of a resume: used once, to fill empty details from a
// resume already written, so the person starts from what they have and not from a blank form.
export function fromResume(resume: string): Partial<Person> {
  const lines = resume.trim().split('\n'), name = (lines[0] ?? '').match(/^#\s+(.+)/)?.[1]?.trim() ?? '';
  const parts = (lines.slice(1).find((l) => l.trim() !== '' && !/^#/.test(l)) ?? '').split(/\s[·|•]\s/).map((s) => s.trim()).filter(Boolean);
  const out: Partial<Person> = name ? { name } : {};
  for (const part of parts) {
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(part)) out.email = part;
    else if (/github\.com\//i.test(part)) out.github = part;
    else if (/linkedin\.com\//i.test(part)) out.linkedin = part;
    else if (/^\+?[\d\s().-]{7,}$/.test(part)) out.phone = part;
    else if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(part)) out.website = part;
    else if (!out.location) out.location = part;
  }
  return out;
}
