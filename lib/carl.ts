// The switch for CARL bullets (RESUME-RULES.md, rules 13 and 14), on unless EGG_CARL=off. A file of its own, with no
// import, so every module can read it: the prompts (lib/writing.ts), the code that reads a resume (lib/ats.ts,
// lib/rules.ts) and the code that writes it (lib/jobs.ts, lib/skills.ts).
export const carlOn = () => process.env.EGG_CARL !== 'off';
