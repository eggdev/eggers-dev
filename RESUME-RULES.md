# Resume generation rules

These are the owner's rules for every resume the app writes. They are kept here word for word. The code that
applies each rule is listed in the last section of this file.

## 1. Map the posting before writing
- Parse the job posting into a list of requirements (required, preferred, implied — e.g. "scale to millions" implies a scale requirement).
- For each requirement, pick the single strongest piece of evidence from the candidate's history.
- The top 3 requirements must be visibly answered in the top third of page one (summary + first role's first bullets).
- Put posting keywords inside bullets, where they come with evidence — never as a copied list.

## 2. Order bullets by relevance, not by source order
- Within each role, sort bullets by relevance to this posting. The first bullet of each recent role is the strongest match.
- For individual-contributor roles, hands-on building comes before adjacent work (training, coaching, admin, process).
- If a role's strongest metric only appears in the summary, also put it in that role's bullets.

## 3. Keep the best metrics
- Maintain a metrics inventory per candidate (users, revenue, latency, adoption, team size, time saved).
- When producing a tailored version, never drop a quantified metric unless it's replaced by a more relevant one. Warn when a version has fewer metrics than the master.
- Prefer concrete proof (500+ users) over vague outcomes (revenue covers costs).

## 4. Detect timeline red flags
- Flag any two roles that both say "Present." Require either an end date or a one-line context note explaining the relationship. Ask the user which; never guess.
- Flag date overlaps longer than 1 month. Ask: contract? part-time? transition? Then label accordingly ("Contract," "Part-time") or fix the dates.
- Merge repeated employers into a single entry with multiple date ranges or titles.
- Never output an entry with zero bullets; merge it or collapse it into a one-line "Earlier experience" section.
- For several short stints (<12 months) in a row, suggest grouping them or labeling contract work.

## 5. Handle title mismatches carefully
- Never change, upgrade, or downgrade an official job title (background checks verify titles).
- If the current title signals management (Director, VP, Head of, CTO) but the target is an individual-contributor role, add a short clarifying tag ("sole engineer," "hands-on") or a context line.
- Don't open the summary with a title that undersells or misrepresents the candidate's actual work.

## 6. Summary
- Max 3 sentences / ~50 words: (1) who they are + years + core stack, (2) one or two best results matched to the posting, (3) the differentiator for this role.
- No third person, no stacking of every achievement.

## 7. Skills section
- Only real tools, languages, and platforms. No soft skills, practices, or phrases lifted from the posting ("cross-team," "enterprise," "reliability").
- Order by relevance to the posting; cap at ~20–25 items.
- Exclude anything the candidate hasn't marked as defensible in an interview (add a "confident" flag per skill in the master profile).

## 8. Size sections by relevance
- Roles 8+ years old or outside the target field: 0–1 bullets.
- Unrelated earlier careers: one line, kept only if it shows leadership or explains a gap.
- Current and previous role get the most space.

## 9. Honesty constraints
- Never invent metrics, titles, dates, employers, or ownership.
- Represent ownership accurately (a company the candidate owns isn't an employer's "project").
- When a fact is ambiguous, ask the user rather than smoothing it over.

## 10. Consistency
- Titles, employers, and dates must be identical across all generated versions and match the candidate's LinkedIn (store LinkedIn data in the profile and diff against it).

## 11. Formatting
- Single column, standard headings (Summary, Experience, Skills, Education), no tables, text boxes, or icons.
- Normalize phone format: (XXX) XXX-XXXX.
- Bullets start with past-tense verbs for past roles, present tense for current ones; no sentence fragments in role descriptions.
- Parse test: extract plain text from the generated PDF and confirm reading order and section headers are intact.

## 12. Final review pass: simulate a six-second skim
After generating, run a separate review step that:
1. States what a recruiter would conclude from only the name, summary, and first role (title, company, dates, first two bullets).
2. Lists any questions that skim would raise ("Is this a step down?", "Two current jobs?", "Why so many short roles?").
3. Checks that each top-3 requirement from step 1 is answered on page one.
4. Revises until there are no unanswered red flags, or returns them to the user as questions.

## Where each rule is applied

"Code" means a function enforces or checks the rule with no model. "Prompt" means a model is told the rule and
nothing in code checks the result. A resume a model wrote is put right by code before it is stored. A resume
the person edited by hand is never rewritten: the same checks only raise flags (`analysis.flags` on the job).

The order for one resume is in `lib/jobs.ts`: `assess` (the posting map), `compose` (write, council, skim), and
after every step a model wrote, `tidy` (header, entries, skills). `publish` then takes the flags again, also
after every hand edit.

| Rule | Where | How |
| --- | --- | --- |
| 1. Requirements as required, preferred, implied | `reading()` item 2 and `SCHEMA` in `lib/jobs.ts` | Prompt. The three classes are fixed by the answer's schema. |
| 1. One strongest evidence for each requirement | `reading()` item 2 (`best`); `withBest()` in `lib/jobs.ts` | Both. The model names one fact or role; code keeps it only if the bank has it. |
| 1. Top 3 answered in the top third of page one | `topRequirements()` and `brief()` in `lib/jobs.ts`; `skimLoop()` in `lib/skim.ts`; `flags()` in `lib/checks.ts` | Both. Code picks the three and passes them on. A model writes the answer, and a second model (the skim) judges it. What is still unanswered after two rewrites is a `top-requirement` flag. |
| 1. Keywords inside bullets, never a copied list | `BULLETS` in `lib/writing.ts`; `withSkills()` in `lib/skills.ts`; `withTerms` removed from `lib/jobs.ts` | Both. Code no longer pastes terms into Skills, and writes the Skills line from the person's own list. Putting a keyword into a bullet is prompt-only. |
| 2. Bullets ordered by relevance; strongest first | `BULLETS` in `lib/writing.ts` | Prompt only. |
| 2. Hands-on building before adjacent work | `BULLETS` in `lib/writing.ts` | Prompt only. |
| 2. A role's strongest metric in the summary is also in its bullets | `SUMMARY` in `lib/writing.ts`; `kept()` in `lib/metrics.ts`; `codeFlags()` and `fixable()` in `lib/checks.ts` | Both. Code finds a metric that is only in the summary, sends it back to the writer once (skim loop), and flags it (`summary-metric`). |
| 3. Metrics inventory | `inventory()` and `metricOf()` in `lib/metrics.ts`; given to the writer by `bank()` in `lib/jobs.ts` | Code. Only the six kinds the rule names. A date, a version, a count of tests or files, and money under 10,000 a year are left out, as is any number whose kind the words do not show. |
| 3. Never drop a metric unless a more relevant one replaces it | `METRICS` in `lib/writing.ts` | Prompt only. Code cannot judge "more relevant". |
| 3. Warn when a version has fewer metrics than the master | `kept()` in `lib/metrics.ts`; `codeFlags()` in `lib/checks.ts` | Code. The master is every inventory metric of the roles the resume shows with bullets. The flag `metrics-dropped` lists what was dropped. |
| 3. Concrete proof over vague outcomes | `SIGNAL` in `lib/writing.ts` | Prompt only. |
| 4. Two roles that say Present | `timeline()` in `lib/timeline.ts`; `syncQuestions()` in `lib/checks.ts`; `answer()` in `lib/raised.ts`; `GET /questions`, `POST /questions` and `PATCH /roles/:id` in `server.ts` | Code. Found in the data, asked of the person with the rule's choices, never guessed. The question is closed only by its own answer, which is applied once. Talk does not list it and cannot close it. |
| 4. Overlaps longer than 1 month | Same | Code. An answer sets the label (Contract, Part-time), a note or an end date on the role. Where a date is only a year, the question says "by up to N months". |
| 4. Repeated employers as one entry | `employers()` and `canonical()` in `lib/entries.ts`; `bank()` in `lib/jobs.ts`; `repairEntries()` | Code. The writer is given one entry for each employer, and an employer written as two entries is never stored. |
| 4. No entry with zero bullets | `ENTRIES` in `lib/writing.ts`; `collapseEmpty()` in `lib/entries.ts`; `codeFlags()` | Both. Code moves such an entry to the Earlier experience line in a written resume, and flags it (`zero-bullets`) in an edited one. |
| 4. Several short stints in a row | `timeline()` in `lib/timeline.ts` | Code finds them and asks. A "group them" answer is passed to the writer (`brief()`), so the grouping itself is prompt-only. |
| 5. Never change a job title | `ENTRIES` in `lib/writing.ts`; `repairEntries()` and `checkEntries()` in `lib/entries.ts` | Both. Code puts the bank's title back in a written resume, checks the repaired text again, and flags a changed title (`facts`) in an edited one. |
| 5. Tag or context line for a management title | `ENTRIES` in `lib/writing.ts` | Prompt only. The person's own one-line note on a role (`roles.note`) is printed by code. |
| 5. Summary does not open on a misleading title | `SUMMARY` in `lib/writing.ts`; the "misleading" answer of the skim in `lib/skim.ts` | Prompt only (two models: the writer, then the skim). |
| 6. Summary: 3 sentences, about 50 words, three parts | `SUMMARY` in `lib/writing.ts`; `codeFlags()` in `lib/checks.ts` | Both for length (flag `summary-long` past 3 sentences or 60 words, sent back to the writer once). The three parts are prompt-only. |
| 6. No third person, no stacking | `SUMMARY`; `codeFlags()` | Both for third person (flag `summary-person`). Stacking is prompt-only. |
| 7. Only tools, languages, platforms | `kindOf()`, `allowed()` and `withSkills()` in `lib/skills.ts` | Code. The Skills line is written by code from the skills list. The kind of a skill is guessed by rule (known names, then the words of the name, then how it is written) and the person can correct it (`POST /skills`). |
| 7. Ordered by relevance, capped at 25 | `resumeSkills()` and `capFor()` in `lib/skills.ts` | Code. Fourteen on a one-page resume. |
| 7. Only skills marked defensible | `allowed()`, `markSkills()` and `syncSkills()` in `lib/skills.ts` | Code. Until the first review, unmarked skills may appear and each resume carries the flag `skills-unconfirmed`. The list counts as reviewed only when the person says so (`reviewed: true`), and only with at least one skill marked confident. Marks alone change no stored resume. |
| 8. Old or unrelated roles get 0 to 1 bullets | `ENTRIES` in `lib/writing.ts` and `limits()` in `lib/jobs.ts`; `codeFlags()` | Both for age (flag `old-role` at 8 years or more, sent back to the writer once). "Outside the target field" is prompt-only. |
| 8. Unrelated earlier careers: one line | `ENTRIES` in `lib/writing.ts` | Prompt only. |
| 8. Current and previous role get the most space | `limits()` in `lib/jobs.ts` | Prompt only. |
| 9. Never invent metrics, titles, dates, employers | `ENTRIES`, `SIGNAL`; `parseResume()` in `lib/resume.ts`; `repairEntries()` in `lib/entries.ts`; `FactsError` in `lib/jobs.ts` | Code for titles, dates and employers. Every entry is checked wherever it is written (any section but Education and Skills, a bold line used as a heading), as is every other line with a date range, and a resume with no job. A version with anything the bank does not have is never stored. Not checked: an entry written under Education, and an invented number (prompt-only), except one that stands only in the context below (`context-number`). |
| 9. Never invent: project context | `bank()` and `contextRules()` in `lib/jobs.ts`; `redact()` in `lib/numbers.ts`; `CONTEXT` in `lib/writing.ts`, given to the first reading, the writer, the council's readers and reviser, and the skim's fix in both `compose()` and `review()` | Both. A project of a role is sent under its role, wherever that role is sent (also when it is filed under another employer), with its facts, which leave the role's own list, and with only the parts that are set (`context`: situation, what the person did, result). Numbers that no fact holds are left out of what the writer is given: in a part, each number that no fact of that project holds (the same value and unit, with the same noun after it or the same words after it; a number with neither, or at the end of a clause, is taken out) is sent as "[number]"; the stored text never changes. The writer is told that a project's name and context explain its facts and are not evidence, that a title, an employer or a date never comes from a project, that a project is never a heading of its own, and never to print "[number]" or put a number in its place. These words are sent only when the bank has a project, a fact's detail or a kept line to explain. What the person learned is never sent to the resume writer, the council or the skim, also not as a kept line of How you work. Code still takes every title, employer and date from the roles (`repairEntries()`); a project written as a heading is the flag `project-heading`, sent back to the writer. |
| 9. Never invent metrics: a number from context | `contextFlags()` and `flagContext()` in `lib/checks.ts`; `unsupported()` in `lib/numbers.ts`; `fixable()` | Code. A number on a resume must stand in a fact of that employer. The flag `context-number` is a number in a bullet whose value stands in the context as stored (the name and parts of every project of a role in the record) and in no fact of the bullet's employer, with its story, metric, number before, team, own part and skills. Only the value is compared, so a number written another way ("6 hrs", "640 daily users", "3x") is never flagged. The code does not know which fact a bullet draws on, so any fact of that employer counts. In the summary any fact counts. A count of years is not checked here, in a bullet or the summary: years come from the role dates. Standards, dates and names that need no guess ("SOC 2", "S3", "24/7") are not counts, and a version is not a count only right after one of the person's tools, languages or platforms ("Node 20", "Python 3.12" when the person lists them). Any other number after a word ("Denver 14", "Billing 3.5") is a count, and any other "35/40" is two counts. The flag `number-mark` is a resume that prints "[number]". Both are sent back to the writer by the skim loop, up to `MAX_REVISIONS` (2) times, and stay flags if they are still there. Not checked: a number in neither the context nor the facts (prompt-only, as before). |
| 9. Never invent metrics: baselines | `bank()` in `lib/jobs.ts`; `saidValue()` in `lib/db.ts`; `CONTEXT` | Both. A fact's `baseline` (the number before, the person's own answer), `team` and `own_part` are sent as fields of the fact. A number in them counts as standing in that fact, for any bullet of the fact's employer. "There was none", "I don't know", "no idea", "not applicable", "TBD" and the like are not values: they are never sent. For the own part, a bare "None" is an answer and is sent. |
| 1 and 2. Strongest evidence and order, helped by the kept lines | `brief()` in `lib/jobs.ts`; `keptLines()` in `lib/record.ts`; `codeFlags()` | Both. Only the lines of How you work the person kept, and that still hold, are sent, with every number taken out ("in [number] of [number] roles"), in a block of their own that says they are not facts and are only for choosing which facts lead. A line about what the person learned is never sent to the resume writer. They are never in the bank and never keyed as facts, and they are no context for `context-number`. A bullet or summary that copies one is the flag `kept-line`. Not checked: a kept line said in other words, not copied. |
| 9. Represent ownership accurately | `ownership()` in `lib/entries.ts`; `ENTRIES` | Both. Code prints "Own company" or "Personal project" on the dates line. Not writing an employer's work as the person's own is prompt-only. |
| 9. Ask when a fact is ambiguous | `ENTRIES`; the writer's `questions` in `compose()`; `openQuestions()` in `lib/talk.ts` | Prompt, and code carries the writer's question to the person in Talk. |
| 10. Titles, employers, dates identical across versions | `canonical()` and `repairEntries()` in `lib/entries.ts` | Code. Every version takes them from the same rows. |
| 10. Match LinkedIn | `positionsIn()`, `storePositions()`, `diffPositions()` and `syncLinkedin()` in `lib/linkedin.ts` | Code. Each difference is a question. "LinkedIn is right" writes its value into the role. For a title, "Both are right: they were separate roles" changes nothing and the two are compared apart from then on. A later export with another value is asked again. |
| 11. Single column, standard headings | `resumeHtml()` in `lib/pdf.ts`; `ENTRIES`; `codeFlags()` | Both. The page is one column by construction. A heading outside the standard ones is flagged (`headings`), not removed. |
| 11. Phone as (XXX) XXX-XXXX | `phoneText()` in `lib/person.ts` | Code. |
| 11. Tense by role; no fragments | `BULLETS` in `lib/writing.ts`; `bullets()` in `lib/ats.ts`; `codeFlags()` | Both for tense (scored, passed to the council's reviser, flag `tense`). "No fragments" is prompt-only. |
| 11. Parse test of the PDF | `readingOrder()` in `lib/resume.ts`; `atsCheck()` in `lib/pdf.ts`; `flags()` | Code. A failure is the flag `parse`. |
| 12. Six-second skim | `skimLoop()` in `lib/skim.ts`; called by `compose()` and `review()` in `lib/jobs.ts` | A model call for steps 1 to 3, on the cheapest model. Code runs the loop: at most two rewrites, then what is left becomes flags, and what only the person can settle becomes questions. |

The message drafts for a job (`draft()` and `storeDrafts()` in `lib/outreach.ts`) are not resumes, but rule 9's
number rule holds for them too. They are given what the person says they learned and the context of the projects whose
facts carry the application, with each number that no fact of that project holds sent as "[number]", and the kept
lines of How you work with every number taken out. A number in a draft whose value stands in the context as stored
(every project's name, parts and what was learned) and in none of the facts, the profile, the posting or the person's
note is unsupported, as is a draft that prints "[number]". What a model wrote about the job (its strengths or verdict)
is no source. Such a draft is sent back once, and the answer takes its place and is checked again; a draft that still
has the problem is left out, and the job says so in one plain line. When every new draft is left out, the earlier
drafts stay.

### Routes these rules added

- `PATCH /roles/:id`: `standing`, `reach` and `partOf` together, as before. Also `end` ("YYYY-MM", or "" for a
  current job), `note` (one line, at most 200 characters) and `label` ("", "Contract" or "Part-time"), each
  optional and each sendable alone. Answers `{ok}` or 400 `{error}`.
- `GET /skills`: `{reviewed, reviewedAt, cap, skills: [{name, kind, mark, facts, shown}]}`.
- `POST /skills` with `{marks: [{name, mark?, kind?}], reviewed?}`: `{ok, marked, reviewed, due}`. `mark` is
  `confident`, `not-confident` or `unmarked`; an empty mark changes nothing, and an entry that is not an object is
  skipped. A body that is not a JSON object is refused (400). The list counts as reviewed only when `reviewed` is
  `true`. That is refused (400, nothing saved) while no tool, language or platform is marked confident. Without a
  review, no stored resume changes. Once the list is reviewed, a mark, a change of kind or a review makes the Skills
  lines of unsent resumes due (`due`); the worker writes them again from the list, with no model, once no mark has
  been saved for two minutes (`refreshDueSkills()` in `lib/jobs.ts`), each job on its own. A mark for a skill Home asks
  about is that question's answer, found by its words (`markFromList()` in `lib/skillsview.ts`); the answers and the
  marks are saved together or not at all.
- `GET /skills` also gives `reviewedOn`, `newCount`, `due`, `dueLine` and `groups`, the list as the Skills screen draws it.
- `GET /jobs/:id` also gives `skillsLine`: what its Skills line waits for, in words. `GET /jobs/:id/resume.pdf`, and
  `PATCH /jobs/:id` with an outcome, first write that job's Skills line from the list when it is due
  (`refreshOneSkillsLine()` in `lib/jobs.ts`).
- `GET /questions`: `{questions: [{key, kind, text, choices, about, inputs}]}`. `kind` is timeline, linkedin or
  skill. `inputs[i]` says what choice `i` needs: "month", "line" or "".
- `POST /questions` with `{key, choice, value?}`: `{ok}` or 400 `{error}`. It applies the answer. A question is
  answered once. These questions are not in `GET /talk`.
- `GET /jobs/:id` also gives `flags`, `skim` and `top`, and each requirement's `need`, `best` and `bestText`.
- `GET /bank` roles also give `start`, `end`, `note` and `label`.
