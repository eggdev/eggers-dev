# Design direction

Rule 4 was changed by the owner on 2026-11-18: the owner's record is taken as given, with no mark of where a value came from.

The studio is a typeset record of a working life. It looks like a well-set document and a catalogue
record. It behaves like a short queue of things that need the owner, with slow work kept out of the way.

The owner approved this direction on 2026-11-17. It replaces the earlier direction (grouped lists, cards
and badges). Section 1 and section 2 are rules: they do not change. Section 3 holds the values that are
still open; the lab (`lab/`) exists to choose them.

## 1. Rules for the look

1. **Two type sizes on a screen, two weights, Geist only.** The sizes are `text` and `title`. All text is
   flush left. Nothing is centred. A third size is a defect.
2. **A hairline rule and white space separate things.** No box, card, fill behind text, shadow, pill or
   rounded container. Controls that the platform draws (a text field, a select) keep their own shape.
3. **One ink, one paper, at most two greys.** `grey` is for secondary text. `line` is for rules. Emphasis
   comes from weight and position. Red (`-exact-system-red`) is only for a failure or a destructive action.
   An accent colour, if the owner keeps one, marks only the one item in focus and links.
4. **Every fact, role, job and resume is a record.** A record has a permanent reference number and a date or
   date range. Its fields always come in the same order: reference, name, dates, extent, status. The owner's record
   is taken as the owner gave it: no screen marks where a value of it came from or how sure it is.
5. **One score for each thing, and status is one plain word.** Status words come from the fixed list in
   section 5. A word outside the list is a defect.

## 2. Rules for the behaviour

6. **Home is one queue of things that need the owner:** questions from the tool, new jobs, facts to confirm,
   applications gone quiet. One item is in focus. Each answer is one key or one tap. Each answer can be
   undone for a short time. The queue can reach empty, and then it says so in one line.
7. **The resume is the screen.** Evidence, flags and questions sit in the margin beside the bullet they
   concern. The tool never changes the owner's text without a visible mark that the owner can reject. Every
   claim links to its fact.
8. **A wait over 10 seconds never shows a spinner.** Slow work is a row in the activity list, with its stage
   and its usual duration. Finished work is announced once, in a "since you were here" line. The word
   "queued" never stands alone.
9. **The tool never guesses.** An unknown pauses only that item and becomes a stored question that says
   what it blocks. An answer is stored and never asked again.
10. **Machine detail stays out of view.** Backups, sign-ins and program checks are behind one door (System).
    No other screen names a server, a folder, a model or a file.

## 3. Open values (the lab chooses these)

A look is one JSON object. The lab draws every screen from it, and the app reads the saved one.

| Key | Meaning | Default | Range |
| --- | --- | --- | --- |
| `home` | What the first screen is | `queue` | `queue`, `document`, `glance` |
| `record` | How a record is drawn | `catalogue` | `catalogue` (stacked fields), `ledger` (one row, columns) |
| `refs` | Where a reference number shows | `gutter` | `gutter`, `inline`, `hidden` |
| `textSize` | Size of `text`, px | 16 | 15 to 18 |
| `ratio` | `title` size divided by `text` size | 1.75 | 1.5 to 2 |
| `strong` | The heavy weight (the light one is 400) | 600 | 500 to 700 |
| `leading` | Line height of `text` | 1.5 | 1.35 to 1.65 |
| `measure` | Width of the main column, rem | 38 | 32 to 44 |
| `margin` | Width of the notes column, rem | 16 | 12 to 20 |
| `rowGap` | Space between rows, px | 12 | 6 to 20 |
| `sectionGap` | Space between sections, px | 48 | 28 to 72 |
| `ruleWeight` | Rule thickness, px | 1 | 0.5 to 2 |
| `greys` | Number of greys | 2 | 1 or 2 |
| `paper` | Paper tone | `white` | `white`, `warm`, `cool` |
| `accent` | The accent colour | `none` | `none`, `orange` (`#bf5700`, the app's old accent) |
| `notes` | Most margin notes beside one line | 2 | 0 to 3 |
| `seed` | The number the variation was drawn from | | any integer |

Colours, light then dark: ink `#111111` / `#ededed`; paper white `#ffffff` / `#111111`, warm `#fbf9f4` /
`#141311`, cool `#f7f9fb` / `#0f1215`; grey `#5c5c5c` / `#a6a6a6`; line `#d9d9d9` / `#333333`; orange `#bf5700` / `#e8813a`. With one
grey, rules use `grey` at 35% opacity. Grey text on paper must pass WCAG AA (4.5 to 1). Orange on warm
paper is just under that (about 4.4 to 1), so orange text needs the heavy weight there.

Found when the lab drew these values:

- Two rules never touch. A section head has a rule above it; the first record under it has none.
- A record in `catalogue` style takes three lines, not six: name; then dates, extent and status on one
  line; then, for a job, where its posting was found. The field order does not change.
- On a phone the gutter takes about 70px of 390px. `refs` set to `inline` suits a phone better.
- With `notes` at 0 the notes column is not drawn, so the main column keeps the page.

## 4. Named patterns

| Name | What it is here |
| --- | --- |
| Accession number | The permanent reference on a record: `F-0142` a fact, `R-07` a role, `J-023` a job, `V-023-C` a resume version. Set in tabular figures. Never reused. |
| Where a posting was found | On a job only: one grey line under it, "From Greenhouse" or "Pasted in by you". A posting is not the owner's own information. |
| Extent and date range | "2019–2023 · 48 facts" on a role. An en dash between years, a middle dot between parts. |
| Sidenote | A note in the margin column, on the row of the bullet it concerns. Under 640px wide it moves below the bullet, indented. |
| Running balance | While a posting is mapped: "7 of 9 requirements answered · 2 open". |
| Revision letter | The version of a tailored resume (A, B, C) with a dated list of what changed. |
| Triage queue | The home queue. Verbs: answer, snooze, undo. |
| Suggestion | A change the tool proposes: the old words struck through in grey, the new words beside them, and Keep / Reject. |
| Activity row | One row for slow work: what, stage, started, usual duration. |
| Digest | "Since you were here": what finished, one line each, shown once. |
| Rotting mark | "No reply in 14 days" on an application. |
| Overlap marker | Two roles that both say Present, drawn as a mark on both, never hidden. |

Exact cannot raise text above the line, so a reference number is never a superscript. A margin note lines
up with a whole bullet or paragraph, never with one line inside it, so each resume bullet is its own row.

## 5. Status words

One word, in `text` size, in grey unless it needs the owner. The whole list:

- A job: `New`, `Reading`, `Read`, `Writing`, `Ready`, `Sent`, `Quiet`, `Closed`, `Failed`.
- A question: `Open`, `Answered`, `Snoozed`.
- Slow work: `Waiting` (always with its place: "Waiting, 2 ahead"), `Running`, `Done`, `Failed`.
- The public page: `Draft`, `Live`, `Offline`.

## 6. How to build it in Exact

- Do not use: `list` with `appearance="auto"` or a grouped `listStyle`, `section` cards, `Badge`,
  `SummaryCard`, `buttonStyle="bordered"`, `"filled"` or `"glass"`, `border-radius`, `box-shadow`, or a
  `background-color` behind text. Write rows with `row`, `column`, `view` and `text`.
- A rule is `hr`, or `border-bottom` with an explicit width.
- An action is a `button` with no `buttonStyle` (the platform's plain text button) or a `link`. The main
  action of a screen is in the heavy weight. A destructive action is red and asks first.
- Sizes are in rem so the browser's text size setting still works.
- Colours are tokens in `app.tamber` with `light-dark()`. No literal colour in a view.
- Two columns come from a grid; read the viewport width and use one column under 640px.
- Numbers that line up use `font-variant-numeric="tabular-nums"`.
- Keep keyboard focus visible, keep semantic roles and labels, and keep every `testId` the tests use.
- The shared pieces (a rule, a section head, a record, a status word, a sidenote, an action) are components.
  A screen does not set a size, weight or colour itself.

## 7. Left out on purpose

A board with columns for the job search; chat as the main screen; a blueprint or terminal look; keyboard
commands as the main way to act (a command box may exist as a laptop shortcut).

## 8. Experience

The Experience screen shows the record as one tree with three levels: **Role → Project → Fact**. Side projects
stand beside the roles. Facts that belong to no role stand in a group named General, after the side projects.

Where each kind of information lives:

- **Role.** A job: employer, title, start, end, employment type and location, as the owner gave them. A role also
  holds how far its work reached users. Stored in `roles`.
- **Project.** A piece of work with a name, dates and four parts: Result, Situation, What I did, What I learned. A
  side project also says where it lives. A project in a role is a row of `projects`. A repository's project group, a
  side project and a repository nobody has placed are rows of `roles` that the resume pipeline already reads, and
  their project points at them (`projects.via_role`).
- **Fact.** One true sentence, with its number, story and evidence. A fact in a role but in no project of it is in
  that role's **Day to day**. Day to day is not a row: it is the role's facts with no project.
- **Not placed yet.** A repository the studio could not place is shown as not placed. Code never puts it in a role;
  the owner places it.

The arrangement the owner chose in the lab (`lab/experience.html`, saved as `lab/experience-keeper.json`):

- Roles first, then side projects, then General.
- An item opens beside the list on a window 1040px wide or more (list and detail columns). On a narrower window it
  opens under its own row. The open item is in the address, so a reload lands on it.
- Only the top level is open at the start. The items above an open, just added or found item open to show it.
- Every level has the same closed line: reference, name, when, and one line of what it holds. Each level steps in
  1.5rem. References stand in the gutter.
- A group shows 6 facts, then "Show all".
- A new thing is added with a short form in place. Only the first line is needed; every other field says
  "(optional)". A form saves only on Add or Save, and has Cancel. A child is added from inside its parent. A new
  item opens at once and is marked "Just added" until the next action, even when a search or the view would hide it.
- "Read as" gives three views of the same data: Roles (the tree), Projects and Facts (sorted).
- An open role shows its six fields as plain values. An open project shows all four parts.
- No note line at the top, and no drafts of what the studio could write.
- The values the screen uses (the first view, facts before "Show all", the step per level, the width for two
  columns) are `experienceLook()` in `look.contract`.

What was rejected, and why:

- A list of stories as the only unit: it hid the job structure, and dropped facts that belong to no story.
- Opening in place with everything open: readers lose their place in nested lists.
- A blank line as the only way to add: it captures a headline and nothing else.
- Naming every missing part on the closed line: it reads as a form to fill in.
- A completeness meter: it measures quantity, not quality.
- Marking where each value comes from (as HR records it, from memory, not marked), and the line on a fact that said
  where it was read from: rejected by the owner on 2026-11-18. The record is as factual as the owner can make it, and
  such a mark is never shown to a reader of a resume.

What makes the studio write unsent resumes again (each changes what a resume is written from):

- Adding or deleting a role.
- Adding a side project.
- Renaming, re-dating or deleting a project that is a side project or comes from a repository.
- Moving a fact to another role.
- Placing a repository.
- Changing a role's title, employer, dates, employment type or whether its work reached users.
- Adding, editing or deleting a fact (its words, story, number or category).
- Filing a fact in a project of its role, or taking it out (also by Keep on a suggestion).
- Renaming a project of a role that holds a fact, or changing its Result, Situation or What I did (also by an answer
  to a question, or by "Use it as the result").
- Giving a fact its number before, its team or the owner's own part.

What does not: adding a project to a role while it holds no fact, What I learned, where a side project lives, changing
a role's location, a verdict on a line of How you work, a suggestion not kept, an
answer of "There was none" or "I don't know", a skill's mark, the review of the skills list, and a Save that changes
nothing. A skill's mark and the review write no resume again; once the list is reviewed, each unsent resume's Skills
line is written again from the list, with no model, once no mark has been saved for 2 minutes (section 9). The studio waits 15 minutes after the last
change by hand, the last Keep or used result, and the last answer to a question, so one sitting of edits causes one
rewrite.

How the record is used when a resume or a message is written: a project of a role is context for its facts, never
evidence. Numbers that no fact holds are left out of what the writer is given, and a number on a resume must stand in a
fact of that employer. The lines of How you work the owner kept help the writer choose which facts lead, are sent
without their numbers, and are never printed. A message to someone at a company may also use what the owner says they
learned on the projects behind the application; a resume never does.

Two known behaviours: a source read again gives its facts new reference numbers; a project deleted that came from a
repository comes back, empty, when that repository is read again.

What stage 2 adds to Experience:

- **Questions for what is missing.** The studio finds what the record lacks and asks about it: where a repository
  nobody placed belongs, when a role started, what a role with nothing in it held, a project's result (then what the
  owner did, then the situation), and, for a measured fact an unsent job leans on, the number before and the owner's
  own part. Experience says "The studio has N questions about this record" in one line and lists them on request,
  each leading to its item. Home takes at most 7 of them at once, in that order, and at most 3 about numbers before
  and own parts. "I don't know" and "I don't remember" are answers: they are kept, and never asked again. An answer
  writes the one value it names, and nothing else. What I learned is never asked.
- **How you work.** At most 3 lines counted from the record, with no model: the kinds of measured result that are
  most of them, managing or hiring in several roles, a skill that runs through several roles, how many projects have
  a measured result, and a lesson said on several projects. Each line says what it was counted from and shows its
  items on request. Below its minimum a line is not drawn; with no line the section is not drawn. The owner keeps a
  line or says it is not true, and can undo either. A kept line helps a resume's and a message's writer choose which
  facts lead; it is never printed.
- **Suggested projects.** On a role with 6 or more facts in Day to day, "Suggest projects" asks a model once. It is
  slow work, a row in Activity. A suggestion is a title, which facts belong to it, and which fact states the result;
  code checks each and drops one that fails, never repairing it. Each shows on the role as a suggestion with Keep,
  Edit and Not a project; Home has one item for a role with suggestions waiting. Keep checks again against the
  record as it is then: a suggestion whose facts moved is out of date and is not kept until the owner edits it. Keep
  files the facts in a new project and leaves their role as it was. A suggested
  result is shown on the kept project for the owner to use or leave out. A title said not to be a project is not
  suggested again.

## 9. Skills

Record's second line has Skills after Experience (`/record/skills`, `skills.contract`). It is the skills list of the
owner's resume rule 7, reviewed in one pass. At the top, one line says where the list stands: "Not reviewed yet. Until
you review this list, skills you have not marked can appear on a resume.", or "Reviewed on 3 Mar 2026. 4 skills are
new since then." Under it is one main action, "I have reviewed this list".

- The list is in groups: skills new since the last review first, under their own head, then Tools, Languages,
  Platforms, and the rest, which never go on a resume. A skill no fact names any more is not listed.
- Each skill is one row: its name, how many facts name it and in how many roles in grey (a tap shows those facts under
  the row, each a link to it), and its mark. On a window 640px wide or more the three stand in columns that line up
  down the list (`LedgerRow` in `look.contract`); on a narrower one the name and the count share a line, and the marks
  go under them. The marks are the three the list has: Confident, Not confident, Not marked.
- A mark is one tap on a word. As an answer on Home, it is held for 8 seconds with Undo, then saved; it is also saved
  when another skill is marked, when the list is reviewed, or when the screen is left. A tap on the mark a skill has
  does nothing and writes nothing.
- Where Home asks about a skill, a mark here is that question's answer, so the two always agree.
- A review is refused, in words, while no tool, language or platform is marked Confident.
- Marks and the review write no resume again (section 8). Once the list is reviewed, they make the Skills lines of
  unsent resumes due: the worker writes each one again from the list, with no model, and prints it, once no mark has
  been saved for 2 minutes, so a sitting of marks prints each resume once. A resume the owner edited is left as it is,
  and one being written is done after it is written. Each job is done on its own: one that cannot be done is tried 3
  times, a minute and then two apart, and then left out, and its page says so. The old PDF is dropped with the old
  line, so it is never older than the text; a PDF that could not be printed is tried once more, and after that it is
  printed when it is opened.
- While the lines are due, one quiet line on Skills says so: "Resumes that are not sent get the new list in about 2
  minutes.", or, after 5 minutes of waiting for a resume being written, that they wait for it. A job's page says it of
  its own resume: "Your skills list changed. This resume gets the new list in about 2 minutes, or when you open its
  PDF." Opening its PDF, or marking it applied, writes that one job's line first. It is no row in Activity: the work
  itself takes seconds.
- "Not marked" is sent as its word; an empty mark changes nothing. The review carries a mark only while one is held,
  and a refused review keeps the held mark on screen.

## 10. The resume screen

A job's resume is shown as the document it is, line by line, with what the studio knows about each line beside it
(rule 7 of the resume rules). It opens from the job at `/job/:id/resume`. The arrangement the owner chose in the lab
(`lab/resume.html`, saved as `lab/resume-keeper.json`):

- **The head.** "Back to the job"; the version's reference and what it was written for ("V-023-C. Written for J-023,
  Staff Engineer at Nimbus Yard, from your record."); the count ("7 of 9 requirements answered · 2 open") and under it
  each open requirement with "Nothing in your record answers it yet."; Edit and Get the PDF; "Version C · 17 Nov 2026"
  and under it one line for each of the last versions, newest first, at most 5, each with its letter, its date and its
  reason ("C  17 Nov  You edited 1 line."). A resume with no version yet is version A, with no lines under it. A job
  with no resume yet says so in one line, with the way back, and draws no document.
- **The count** is what the reading of the record found, exactly as the job page counts it: a requirement is answered
  unless nothing in the record answers it. Whether the resume's words answer a requirement is not known to code.
- **What the record has more for,** from stored data and no model, under one grey line: "Your record has more for these
  requirements than this resume uses:". Each item names the requirement and says only what is true: "F-0115, in R-07
  Platform Engineer, Tamarack Analytics, which this resume does not show." or "F-0122, in R-02 Senior Engineer,
  Corvane Logistics. No bullet under that job uses it." That second kind is said only for a job Experience shows, and
  only with a record of which facts each line uses: lines outside Experience carry no such record, so of a fact whose
  work is shown only there nothing is said. The resume shows a role or project wherever it names it:
  Experience, the Earlier experience line, Projects or any other section. A side project, a repository filed under an
  employer and one nobody placed are named with their project reference (P-…), as Experience names them. A best fact
  deleted since is not mentioned. With no record of which facts each line uses, only "does not show" is said.
- **One row for each line**, in three columns of fixed width: the gutter, the resume column (38rem) and the notes
  column (16rem), rows 12px apart. A section head spans the resume and notes columns. Under 640px wide a row's notes
  and an opened fact go under its line, indented; the gutter stays, narrower.
- **The gutter** holds the facts a line uses, one under another, and on a heading the reference of each role it is
  about (an entry that names two titles of one employer shows both; a side project shows its project reference). Two
  lines of the same words each show their own facts. Tapping a fact opens it as the first thing in that row's notes:
  its reference and words, its dates and number, and where it sits in the record. Tapping it again, or Close, closes
  it. One fact is open at a time. One value (`resumeLook().cite`) turns the fact references off and leaves the role
  and project references and the notes as they are. A reference never breaks at its hyphen.
- **Notes on the line they concern:** a failed check leads with "Failed check" in red, another flag with "Flag", a
  question with "Question" and a way to where it is answered: "Answer it on Home" only while Home's list holds it,
  else the way to where Experience settles it. Then, in grey, what the owner did: "You edited this line on 14 Nov. It
  used F-0153 before your edit." or "You wrote this line." Neither is worded as a fault. A note beside its line is
  worded for the owner: it never quotes the line, never tells a writer what to do, and says what is wrong and what the
  record says ("900 is in none of the facts this line uses. F-0004 says …"). The job page's list keeps its own words. At most 2 notes beside one line, then "N more" and "Show fewer". A line with nothing
  to say shows nothing. A question about a fact is on every line that uses it; one about a role is on its heading. A
  fact used and since deleted says "F-0142 is no longer in your record." on its line. Each note is true together with
  the gutter of its row: "This line names no fact of your record." stands only on a line whose gutter shows no fact; a
  line whose facts are of another job, or gone, has the note of each fact and no other. A heading whose title the record
  lacks still shows its role (the employer's row of the same dates, else the newest), and its note names both titles.
- **Suggestions** (rule 7: the studio never changes the owner's text without a mark the owner can reject). On a
  resume the owner edited and has not sent, a change code can word exactly from the owner's own list and record is a
  suggestion, drawn in place on its line: the words that go struck through in grey, the words that come after them
  underlined, the rest as it is (a word-level difference, so "Go, Python, Kafka" to "Go, Python" strikes only
  ", Kafka"). A screen reader hears "removed:" and "added:". Under the line, "Keep" (heavy) and "Reject"; the reason is
  the first note on the row, led by "Suggestion", so the cap of 2 never hides it. While it is open, the check it
  answers (the title or employer check on its heading, the dates check of its entry) is not said again; it is said
  again after Reject, or when the suggestion goes stale. After either choice, one grey line with Undo: "Kept. The
  suggested words are in." or "Rejected. Your words stay." Under 640px the reason and the actions sit under the line.
  No model is asked in this stage. A suggestion comes from:
  - the skills list: the skills the owner marked "not confident" are taken out of a line under the Skills heading, as
    it stands ("You marked Python and Kotlin as not confident."). Nothing is added, moved or reworded; a skill the
    list does not have stays (the skills flag speaks of it); the heading itself is never touched. Only after the first
    review, never when the line would be left empty, and again only when another skill on the line is marked not
    confident;
  - the record: a heading's title or employer ("Your record gives the title as “Staff Engineer”."), and the date range
    of a dates line ("Your record gives the dates as Mar 2021 – Present."). The rest of a dates line, such as a place
    or a label, stays as the owner wrote it.
  It never says where the record's value came from or how sure it is. The job's page says in one quiet line that leads
  here when an edited resume has open suggestions: "The studio suggests 2 changes to this resume." Home does not list
  them.
- **A bullet's new opening, made by code.** Every suggestion on an edited resume is made by code from the owner's own
  list, record and words; no model writes words for an edited resume. Besides the Skills line, a heading and a dates
  line, code suggests a new opening for a bullet in exactly two cases, after the owner's Save (and in the pass after a
  role change). The tense: a bullet the skim flags for the wrong tense gets only its first word's ending changed ("Lead
  the weekly incident review." to "Led the weekly incident review."; for a job held now, "Built" to "Build"), with the
  reason "Past tense for a job that has ended." or "Present tense for the job you hold now." It is made only when the
  first word is surely a verb: one the studio's verb table knows, and not a title ("Lead engineer…", "Head of…").
  A duty opener: "Responsible for", "Was responsible for", "Tasked with", "In charge of", "Duties included", "Duties
  include" or "Charged with", followed at once by the owner's own -ing verb, becomes that verb in the tense the job
  needs ("Responsible for building the scheduler…" to "Built the scheduler…"), with the reason "Opens with what you
  did: “Built”, in place of “Responsible for building”." Not "Worked on", "Helped", "Assisted", "Involved in",
  "Served as" or any other opener, and not an opener followed by a noun ("Responsible for the nightly billing run."):
  those keep their flag, and the owner rewords them. For both, the word right after the changed verb must open what
  it acts on (a determiner such as "the", "a", "our", "every", but not "that"; or a whole count with a plural word soon after
  it, such as "4 new hires", and not a label or a version such as "2.0" or "24/7"); otherwise the verb may be a noun or an
  adjective ("Design system for…", "Responsible for building maintenance.") or one of a list of verbs, and there is no
  suggestion. Either way the rest of the line stays byte for byte, and its
  facts move to the new words unchanged. A bullet over the word limit keeps its flag; the owner trims it. These are
  drawn, kept, rejected and undone as any suggestion.
- **The whole resume's notes** (what cannot be placed on one line without a guess) are one short block under the head.
- **A resume with no record of which facts each line uses** (written before links, or with links the studio cannot
  read) says so once: "The studio has no record of which facts each line of this resume uses. Write it again to record
  them." It shows no fact references.
- **The readers' weak lines** from the council are shown only while the resume is the text they read; one that stands in
  no single line goes to the whole-resume block with the words it quoted.

A line's facts are the writer's statement of which facts it uses, checked by code for what code can check: that each
fact exists, belongs to the line's job and holds the line's numbers. Code cannot check that the words of a line with no
number say what its facts say; the owner's check is the fact opened beside the line. A link is never called verified.
The owner's record is taken as given (rule 4): an opened fact never says where it was read from, when it was added, or
how sure it is.

What was rejected, and why:

- Notes under each bullet: the document stops reading as a document. A rail of marks beside each bullet: a mark has to
  be opened to say anything, and says nothing at a glance.
- Fact references at the end of each line, in grey: they read as part of the resume. Hidden until asked: the owner
  could not see which lines use no fact.
- The resume drawn as a printed sheet: the PDF is the printed sheet; the screen is for working on it.
- A note that needs judgment the code cannot give honestly ("the posting does not ask about users", "three lines
  long", two facts that disagree): it would be a guess shown as a finding.
- Answering a question in the margin: a later stage. Suggestions with no model are built: see Suggestions and A
  bullet's new opening above.
- Wording written by a model for the owner's own lines, even on request and behind a whitelist of the line's words: a
  line's claim changes when words are left out ("Plan the move of billing to Go." becomes "Moved billing to Go."), and
  code cannot tell which words carry the meaning.
- A shorter line made by leaving words out, for the same reason. A bullet over the word limit keeps its flag.
