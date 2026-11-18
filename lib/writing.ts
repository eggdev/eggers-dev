// How anything written for the person is worded, and which numbers earn a place. One text, given
// to every prompt that writes a fact, a profile or a resume, and to the council and the skim that review a
// resume (lib/council.ts, lib/skim.ts), so they all hold the same line.
//
// WRITING and SIGNAL are for everything. METRICS, BULLETS, SUMMARY and ENTRIES are for a resume only: they
// state the owner's resume rules (RESUME-RULES.md, rules 2, 3, 4, 5, 6, 8, 9 and 11) as instructions. Where
// one of those rules is also checked in code, the last section of RESUME-RULES.md says where.

export const WRITING = `Wording:
- Plain words. Never: leverage, utilize, facilitate, foster, enhance, showcase, robust, seamless, spearheaded, cutting-edge, passionate, delve, crucial, pivotal, landscape. Write "use", "help", "build", "improve", "show", or name the specific change.
- Name what was done and who did it. No passive voice where the person was the actor.
- No clause tacked on the end that claims a benefit without evidence ("..., ensuring reliability", "..., improving answer quality", "..., enabling teams to move faster"). State the result as a fact with its evidence, or leave it out.
- No lists of three for rhythm. Count the real items.
- One idea per sentence. No dashes used as a pause, and no semicolons.
- No adverbs propping up a claim ("significantly", "successfully", "effectively").
- A reader who has never heard of the company's internal projects must understand every line. Say what a named system is in a few words the first time ("Atlas, an equipment checkout app"), or describe it without the name.
- Every sentence must be something a stranger could restate as a concrete fact. If a line could appear unchanged on anyone's resume, it says nothing: cut it or make it specific.`;

export const SIGNAL = `Which numbers and details to show:
- Impact metrics are kept. An impact metric is a measured result of one of these kinds: users, revenue or money at a size that matters, latency, adoption, team size led, time saved. When space is short, cut a line with no result before a line that carries one.
- Prefer concrete proof to a vague outcome: "500+ users" says more than "revenue covers costs". Where the bank has a number for the work, show the number.
- Incidental numbers stay out, because they make the person look junior: a count of tests written, a handful of files or endpoints, savings of a few hundred dollars, version numbers, the date something launched or was merged, how many days ago it shipped, ticket or pull-request counts, and numbers about process that measure no result.
- Never show a calendar date inside a bullet. Dates belong only on the line under a role's heading.
- No number is ever changed or invented: a number that is shown is exactly as the bank has it.
- Leave out a line whose point an outsider cannot follow, or that describes process ("restructured workflows", "added guardrails") without saying what was built and what it did for someone. Prefer the fact with a clear thing built and a clear user.
- Implementation detail (retry logic, manifests, idempotency keys, lint rules) is shown only where the posting asks for that skill, and then in one clause, not as the point of the bullet.`;

// Rule 3. The inventory itself is built in code (lib/metrics.ts) and given to the writer beside this text.
export const METRICS = `Keeping the best metrics:
- The person's impact metrics are listed for you as the metrics inventory, each under the role it belongs to.
- For every role you give bullets to, each of that role's inventory metrics appears in that role's bullets. Leave one out only when a more relevant inventory metric for this posting takes its place in the same role. Never leave one out only to save words: cut a bullet with no result first.
- A number that is not in the inventory is not protected. The rules above on incidental numbers decide whether it is shown.`;

// How a resume's bullets are built and ordered (rules 1, 2 and 11). The rule-based score (lib/ats.ts) checks
// the opening verb and its tense, a duty opening, length, and a verb repeated three times running.
export const BULLETS = `Bullets:
- Tense follows the role. Under the current role (its dates end in "Present") every bullet opens with a present-tense verb ("Build", "Lead", "Run"). Under a past role every bullet opens with a past-tense verb ("Built", "Led", "Cut"). Never open with "Technical lead for", "Served as", "Responsible for", "Worked on" or "Worked with": say what is or was done.
- Every bullet is a whole statement: a verb, what it acted on, and for whom or with what result. No fragments and no bare lists ("Python, Django, REST APIs").
- One claim per bullet. A bullet that joins two pieces of work with "and" is two bullets, or the weaker one is cut.
- Within a role, no three bullets in a row open with the same verb.
- Order inside a bullet: what was done, with what tool or method where the bank names one, then its result where the bank has one worth showing. A bullet with no result must still say what the thing was and who used it.
- Order of the bullets: within each role, sort them by how well they answer this posting, never by the order of the bank. The first bullet of each recent role is that role's strongest match to the posting.
- When the posting is for an individual-contributor role, hands-on building comes before adjacent work (training, coaching, administration, process) inside every role.
- The posting's keywords go inside the bullets whose work used them, so each stands beside its evidence. Never add them as a list, and never use one the bank does not support.
- A bullet that only names a stack ("Built backend APIs in Python with Django REST Framework") is never shown.
- No "I", "my" or "we" anywhere: a resume leaves the subject out ("Built", not "I built").
- An abbreviation the posting spells out is written both ways the first time ("Model Context Protocol (MCP)"), so a search for either finds it.
- Every statement about a role matches the bank's facts for that role exactly: who was led, what the product was, what the person owned. Do not merge two roles' work into one line.`;

// Rule 6, with the parts of rules 2 and 5 that touch the summary. Its length and its person are checked in code (lib/checks.ts).
export const SUMMARY = `The Summary:
- At most three sentences and about 50 words in all.
- Sentence one: who the person is, their years of experience (counted from the bank's role dates, never rounded up) and their core stack. Sentence two: one or two of their best results, the ones that match this posting, each number exactly as the bank has it. Sentence three: what sets them apart for this role.
- First person with the subject left out ("Engineer with 12 years building..."). Never third person: not the person's name, not "he", "she" or "they".
- Two results at most. Do not stack every achievement into it.
- Do not open with a title that undersells or misrepresents the work the person does. A director who works as the only engineer opens on the engineering, and may name both.
- A result named in the Summary is also in the bullets of the role it came from. The Summary repeats a role's strongest metric. It never holds the only copy.`;

// Rules 4, 5, 8, 9 and 11: which sections and entries a resume has, and what in them is never changed. The
// headings, dates and labels are also put back from the data in code (lib/entries.ts).
export const ENTRIES = `Sections and entries:
- One column of plain Markdown. Only these sections, in this order: "## Summary", "## Experience", "## Earlier experience" (only when it is needed), "## Skills", "## Education". No other section, and no Projects section. No tables, columns, text boxes, images or icons.
- Each item of the bank's "entries" is one employer, and is at most one entry on the resume, whatever number of titles the person held there and however often they left and returned. Never split one employer into two entries.
- Each bank entry gives its "heading", its "dates" line, and where it has them its "previously" lines and its "note". Write the heading as "### " and the heading, then the dates line, then each "previously" line, then the note, each on its own line. Copy them character for character.
- Never change, upgrade, downgrade, shorten or reword a job title, an employer's name or a date. A background check verifies them. Never invent a title, an employer, a date, a number or who owned a piece of work.
- A label on the dates line (Contract, Part-time, Own company, Personal project) says what the work was: keep it. Work for a company the person owns is an Experience entry that says so. It is never written as an employer's project, and an employer's work is never written as the person's own company.
- A role's "projects" are work done in that job. Write them as that role's bullets, never as separate entries.
- When the current title signals management (Director, VP, Head of, CTO, Manager) and the posting is for an individual-contributor role, add one short context line under the dates that says what the person does hands-on, from the bank ("Sole engineer: designs, builds and runs every system below."). The title itself stays as it is.
- Dates are written on an entry's dates line and its "previously" lines, on the Earlier experience line and under Education, and nowhere else: no date range in a context line, in Skills, or in any line outside an entry. Every job is written as an entry under "## Experience" with its "### " heading. A job written any other way is taken for one the bank does not have, and the resume is not kept.
- Never write an entry with zero bullets. A role that earns no bullet is left out, or is named on the single line under "## Earlier experience", using its "earlier" text exactly. Items on that line are parted by "; ".
- Size each entry by its relevance to this posting. The current role and the one before it get the most space. A role that ended 8 or more years ago, or that is outside the field of this posting, gets one bullet at most, or goes on the Earlier experience line. An unrelated earlier career is one item on that line, and is kept only if it shows leadership or explains a gap in the dates.
- When a fact in the bank is ambiguous (who owned the work, what a number measured, which role it belongs to), leave it out and return it as a question for the person. Never smooth it over.`;

// Said wherever context with numbers taken out is sent (lib/numbers.ts, redact): the resume's writer (in CONTEXT) and the
// message drafts.
export const NUMBER_MARK = '"[number]" stands where a number was left out because no fact holds it. Never print "[number]", and never put a number of your own in its place.';

// What a project of a role is to the writer (stage 3 of the record as a tree): context for its facts, never evidence.
// It goes with the bank wherever a model is given it (the writer, the council's readers and reviser, the skim's fix), and
// only when the bank has a project of a role, a fact's details or a kept line to explain (lib/jobs.ts, contextRules).
export const CONTEXT = `Projects and the details of a fact:
- Some facts of a role are grouped in its "projects". A project's "name" groups its facts, and its "context" (the situation before, what the person did, the result, in the person's own words) explains them. Neither is evidence. Print nothing from a project's name or context unless one of the project's facts says it too, and never take a title, an employer or a date from a project: those come only from the entry and its roles. A project is never a heading or a sub-heading of its own, and never has dates of its own: its facts are bullets of its role.
- A number is printed only when it stands in a fact: in its text, detail or metric, or in its "baseline" (the person's own answer about the number before), its "team" (how many worked on it) or its "own_part" (what the person did themselves). "own_part" also says how much of the work to claim: never claim more of it than that.
- ${NUMBER_MARK}`;

// The kept lines of "How you work" (lib/derived.ts), when they are given to a writer: they help choose, and are never printed.
export const KEPT_LINES = 'Counted from the record and confirmed by the person. Not facts: never print one, never quote its numbers; use them only to choose which facts lead.';

// What the person says they learned, given to the message drafts only (lib/outreach.ts), never to the resume writer.
export const LEARNED = 'What the person says they learned, in their own words, and the background of each project whose facts carry this application. They may be said in the person’s voice ("I learned…"). They are not results, and no number from them is used unless one of the project’s facts has it.';
