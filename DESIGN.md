# Design direction

The studio adapts the Linear design system from Better Design
(<https://better-design.com/design-systems/linear>). It uses near-black surfaces, Geist, one indigo accent
and compact spacing. The owner chose this direction on 2026-11-20. It replaces the "typeset record" direction of 2026-11-17 (one
ink, hairline rules, no cards).

Page structure follows a second reference the owner chose the same day: one next action on a screen, a
sidebar, cards with a plain title that says what the text is for, and long text folded behind one control.

Sections 1 to 6 are the look. Section 2 holds the behaviour rules, which did not change except where
marked. Sections 8 to 12 describe single screens and keep their numbers because the code cites them; where
their wording about the look (rules, two sizes, no boxes, grey words) differs from sections 1 to 6, sections
1 to 6 win, and each of those screens takes the new parts when it is next rebuilt.

**What comes from Linear and what is ours.** Linear's system gives the colours, the radius scale, the
motion values, the font, the density and its five layout sizes, and the icon set (Iconoir). It declares no
type scale, no spacing scale beyond those five sizes, no light theme and no status colours for text. Those
are this project's choices and are marked "ours" below.

## 1. Rules for the look

Look rules are numbered L1 to L9. The plain numbers 6 to 12 are the behaviour rules of section 2, which the code cites. Where code or an older note says "rule 4" it means L6, and "rule 5" means L7.

- **L1. Dark only.** The system has one theme. The app sets the dark scheme itself, so the platform's own
   controls are dark too. There is no light theme until the owner asks for one.
- **L2. Depth is a lighter fill and one outline.** A card is one step lighter than the page; a control or a
   well is one step lighter than the card; a hovered row is one step lighter again. Each has a 1px `line`
   outline of one colour on every side. No drop shadow on anything that sits in the page. No gradient, no
   glow, no glass.
- **L3. One accent.** Indigo marks the main action of a screen, the focus ring, a selected control and text
   selection. It is never decoration and never a status. A link or a selected word in text uses `link`,
   the accent made lighter so it passes contrast on the dark page.
- **L4. Colour for status only with words.** Green, amber and red say a state, always next to a word or an
   icon that says the same thing. Red is for a failure or a destructive action.
- **L5. Type is Geist in a fixed scale of five sizes and three weights** (section 3). The page title is the
   size of a section heading, not a display size. The one display size is for the one thing a page is
   about (a person's name, one number). Bold is for that, for section headings and for a value that is
   selected. Labels are sentence case; no capitals with wide spacing.
- **L6. Every record keeps its fields in one order:** reference, name, dates, extent, status. The owner's
   record is taken as the owner gave it. No screen marks how sure a value is or asks the owner to confirm
   it. A line may open the owner's own words behind it when the owner asks for them (section 4, "Your
   words"); that is the only thing shown about where a value came from.
- **L7. One score for each thing, and status is one word** from the list in section 5, drawn as a tag.
- **L8. No completeness meter, no percentage of a profile done.** (Owner, 2026-11-17.)
- **L9. Facts on a line are separate items with a gap between them.** A screen rebuilt in this system does
   not join facts with a middle dot. `joinDot` stays on screens not yet rebuilt and goes when they are.

## 2. Rules for the behaviour

Unchanged from 2026-11-17 except rule 6, which no longer lists "facts to confirm" (the owner's facts are
confirmed by being given).

6. **Home is one queue of things that need the owner:** questions from the tool, new jobs, applications
   gone quiet. One item is in focus. Each answer is one key or one tap. Each answer can be undone for a
   short time. The queue can reach empty, and then it says so in one line.
7. **The resume is the screen.** Evidence, flags and questions sit in the margin beside the bullet they
   concern. The tool never changes the owner's text without a visible mark that the owner can reject. Every
   claim links to its fact.
8. **A wait over 10 seconds never shows a spinner.** Slow work is a row in the activity list, with its stage
   and its usual duration. Finished work is announced once, in a "since you were here" line. The word
   "queued" never stands alone.
9. **The tool never guesses.** An unknown pauses only that item and becomes a stored question that says
   what it blocks. An answer is stored and never asked again. A question asks for more of the story; it
   never asks whether something the owner said is true, and never questions a date.
10. **Machine detail stays out of view.** Backups, sign-ins and program checks are behind one door (System).
    No other screen names a server, a folder, a model or a file.
    "Start a new record" lives there too, under the backup controls, because it is the one action whose safety
    rests on a backup: it deletes the career record and what was written from it, and keeps the owner's details,
    direction, the job tracker and each sent resume. Its red action opens a dialog that lists what goes and what
    stays, says it cannot be undone, and enables its red button only once the owner types "start a new record". In
    the deployed studio the screen takes a backup first and goes on only when it succeeded, then backs up the new
    record at once and says in one line what was deleted, what was kept and whether that backup was taken. On a
    machine with no studio around it, the section shows on its own and the reset goes on with no backup.
11. **A screen has one next action.** It is the only filled button on the screen. Everything else is a plain
    or outlined control.
12. **Text the tool wrote says what it is used for,** in one short line under its title ("Resumes and
    messages start from these"). An edit by the owner is kept; a later reading never replaces it.

## 3. Values

Colours are tokens in `app.tamber`, each fixed to one value (`scheme=fixed`). No literal colour in a view.

| Token | Value | Linear's name | Use |
| --- | --- | --- | --- |
| `look.paper` | `#08090a` | background | the page |
| `look.card` | `#0d0e11` | card | a card, the sidebar |
| `look.raised` | `#16171b` | secondary, input | a control, a well, a tag |
| `look.hover` | `#1d1e22` | accent | a hovered or selected row |
| `look.line` | `#24262b` | border | every outline and rule |
| `look.ink` | `#f7f8f8` | foreground | text |
| `look.grey` | `#9b9eab` | muted-foreground | secondary text (7.2 to 1 on a card) |
| `look.faint` | `#868798` | secondary-foreground | a caption, a count (5.4 to 1 on a card) |
| `look.accent`, `AccentColor` | `#5e6ad2` | primary, ring | the main action, focus, selection |
| `look.on-accent` | `#ffffff` | primary-foreground | a label on the accent |
| `look.link` | `#95a4f6` | ours | a link or selected word in text (8.2 to 1 on a card) |
| `look.danger` | `#7f1d1d` | destructive | the fill of a destructive button |
| `look.green` | `#67d283` | ours | a good state, as text |
| `look.amber` | `#e9b452` | ours | a state that needs the owner, as text |
| `look.red` | `#fd736d` | ours | a failure, as text |

The accent as text on the page is 4.2 to 1, under the 4.5 to 1 floor: use `look.link` for text. White on
the accent is 4.4 to 1, which Linear ships for its button label; keep that label at the medium weight.

Type (ours; sizes taken from the system's component styles). All in rem.

| Name | Size | Weight | Line height | Use |
| --- | --- | --- | --- | --- |
| `display` | 1.75rem (28px) | 600 | 1.35 | the one thing the page is about |
| `title` | 1.25rem (20px) | 600 | 1.3 | the page title, a section heading |
| `lead` | 1rem (16px) | 500 | 1.4 | a card's title, a record's name |
| `text` | 0.875rem (14px) | 400 | 1.5 | running text, a control's label (500) |
| `small` | 0.8125rem (13px) | 400 or 500 | 1.4 | a label, secondary detail |
| `caption` | 0.6875rem (11px) | 500 | 1.4 | a tag, a count, a table's column head |

Display and title are set tighter (`letter-spacing` -0.02em and -0.01em). Numbers that line up use
tabular figures. A measure of running text is at most 42rem.

Space (Linear's compact density; the step is 0.25rem).

| Role | Value |
| --- | --- |
| Sidebar width | 11.5rem |
| Page inset | 1rem (1.5rem from 1040px wide) |
| Gap between sections or cards | 1.5rem |
| Gap between columns, and between rows in a card | 0.75rem |
| Card padding | 1rem, capped at 24px |
| Inside a group (label to field, title to its line) | 0.25rem to 0.5rem |

Shape: radius 4px (a key cap), 6px (a control), 8px (a card), 12px (a sheet); a tag is fully round.
Outline: 1px, `look.line`. Motion: 120ms for a control, 160ms for a surface, 220ms for a sheet, easing
`cubic-bezier(0.25, 0.46, 0.45, 0.94)`; nothing moves under reduced motion.

Widths: one column under 640px; the sidebar and a right rail of 20rem from 1040px.

## 4. Named patterns

| Name | What it is here |
| --- | --- |
| Shell | From 1040px wide: a sidebar on `look.card` with the six places, and the page beside it. Narrower: the places in one bar at the top, which scrolls when the labels need more room. The current place has the `look.hover` fill, never a coloured edge. |
| Card | A group of things that belong together: `look.card`, a 1px outline, 8px radius, 1rem padding. Its title is `lead`; one `small` grey line under it may say what the text is for. One control at its top right at most. Cards do not nest. |
| Rail | From 1040px wide, a 20rem column to the right of the main column for what the owner can add or answer. On Profile at narrower widths, the question follows the identity and the document link follows the main column. |
| Tag | A status word from section 5 or a count: `caption`, fully round, `look.raised` fill with `look.grey` text; green, amber or red text when the state is one of those. |
| Next action | The one filled button of a screen (rule 11), with a count when there is one ("5 ready"). |
| Folded text | Long text shows its first lines and one control, "Read more" or "Show all 4". A whole document opens as its own route. |
| One question | One open question at a time, with why it is asked in one grey line, a field for the answer, and Skip. It says how many are open, as a count, never as progress. |
| Your words | On a line of the record, a control that opens the words the owner said or wrote that the line was taken from, with the date. A line with none shows nothing. |
| Accession number | The permanent reference on a record: `F-0142` a fact, `R-07` a role, `J-023` a job, `V-023-C` a resume version. Set in tabular figures, `small`, `look.faint`. Never reused. |
| Where a posting was found | On a job only: one grey line under it, "From Greenhouse" or "Pasted in by you". A posting is not the owner's own information. |
| Extent and date range | "2019–2023" and "48 facts" on a role, as two items. An en dash between years. |
| Sidenote | A note in the margin column, on the row of the bullet it concerns. Under 640px wide it moves below the bullet, indented. |
| Running balance | While a posting is mapped: "7 of 9 requirements answered", "2 open". |
| Revision letter | The version of a tailored resume (A, B, C) with a dated list of what changed. |
| Triage queue | The home queue. Verbs: answer, snooze, undo. |
| Suggestion | A change the tool proposes: the old words struck through in grey, the new words beside them, and Keep / Reject. |
| Activity row | One row for slow work: what, stage, started, usual duration. |
| Digest | "Since you were here": what finished, one line each, shown once. |
| Rotting mark | "No reply in 14 days" on an application, as an amber tag. |

Withdrawn: the overlap marker (two roles that both say Present). The owner's dates are honoured and never
marked (2026-11-18). Code that still draws or asks about it is to be removed.

Exact cannot raise text above the line, so a reference number is never a superscript. A margin note lines
up with a whole bullet or paragraph, never with one line inside it, so each resume bullet is its own row.

## 5. Status words

One word, as a tag. The whole list:

- A job: `New`, `Reading`, `Read`, `Writing`, `Ready`, `Sent`, `Quiet`, `Closed`, `Failed`.
- A question: `Open`, `Answered`, `Snoozed`.
- Slow work: `Waiting` (always with its place: "Waiting, 2 ahead"), `Running`, `Done`, `Failed`.
- The public page: `Draft`, `Live`, `Offline`.

`Ready` and `Done` are green. `Quiet` and `Open` are amber. `Failed` is red. The rest are grey.

## 6. How to build it in Exact

Linear's system is written for the web as `ds-*` classes. The studio applies its colours, typography and
layout through shared Exact components.

- **The shared parts are components in `look.contract`.** A screen sets no size, weight, colour, radius or
  gap itself. To change a value, change it there or in `app.tamber`.
- **A card** is a `column` with `background-color="look.card"`, `border="1px solid look.line"` (or the
  width, style and colour the build accepts), `border-radius` and padding from `look.contract`. This
  replaces the earlier ban on boxes, fills and rounded containers.
- **A tag** is a `row` with the `look.raised` fill and full radius, holding one `caption` text. Do not use
  `Badge` from `exact:content` unless it takes these tokens.
- **The main action** uses the platform's `buttonStyle="bordered-prominent"`, filled with `AccentColor`.
  A destructive action uses `destructive=true` and asks first. The shared secondary button uses `look.raised`,
  one `look.line` outline and a wrapping label. Quiet actions use the link colour and a 44px hit target.
  Both retain button semantics and keyboard focus.
- **A field** is the platform's `input`, `textarea` or `select`, with a visible label above it in `small`.
- **The scheme** is set once at the root (`color-scheme="dark"` on the root, and `setScheme("dark")` where
  the app starts), so every platform control is dark.
- **The font** is declared once (`font "Geist" = "assets/fonts/Geist.ttf"`, the variable file, with its
  licence beside it) and named once at the root.
- **A rule** is `hr`, or a `border-bottom` with an explicit width, in `look.line`.
- **Sizes are in rem** so the browser's text size setting still works.
- **Two columns come from the viewport width:** one column under 640px, the sidebar and the rail from 1040px.
- **An icon** is `image "symbol:<role>"`, or an Iconoir SVG declared in `app.tamber`'s `icons` block. Never
  a character or an emoji. A place in the sidebar may be a word alone.
- **Hover** only lightens the fill by one step. It never moves a control and never uses the accent.
- **Keep keyboard focus visible, keep semantic roles and labels, and keep every `testId` the tests use.**

Not used: a drop shadow in the page, a gradient, a literal colour in a view, centred running text, capitals
with wide spacing, a coloured bar on the edge of a selected item, an emoji, a spinner for a long wait.

## 7. Left out on purpose

A board with columns for the job search; chat as the main screen; a blueprint or terminal look; keyboard
commands as the main way to act (a command box may exist as a laptop shortcut).

## 8. Experience

The Experience screen shows the record as one tree with three levels: **Role → Project → Fact**. Side projects
stand beside the roles. Facts that belong to no role stand in a group named General, after the side projects.

Where each kind of information lives:

- **Role.** A job: employer, title, start, end, employment type and location, as the owner gave them. A role also
  holds how far its work reached users. Stored in `roles`.
- **Project.** A piece of work with a name, dates and four parts: Context, Action, Result, Learning. A
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
- An open role shows its six fields as plain values, and "Tell a story from this job" (section 11). An open project
  shows all four parts, in their order: Context, Action, Result, Learning. A part not yet written is offered as "Add the
  context" (and so on).
- An empty record says, in two lines, that it starts with a job and that each job is told one story at a time, with one
  action, "Add a job", which opens the add-role form. Sources stay on their own screen. Home on an empty record has one
  item, "Your record is empty. Add your first job, then tell a story from it.", that leads to Experience.

A project is told in the four CARL parts (the owner, 2026-11-19), and a resume's bullets follow the same form
(RESUME-RULES.md, rule 13):

- **Context**: the setting, scope or challenge, said briefly.
- **Action**: the specific steps the person took.
- **Result**: the measured outcome.
- **Learning**: what the person learned, or how the skill applies to the next role.

The parts were named Situation, What I did, Result and What I learned before. The columns took the new names in a
start-up step that changes no stored value (`lib/db.ts`).
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
- Renaming a project of a role that holds a fact, or changing its Context, Action, Result or Learning (also by an
  answer to a question, or by "Use it as the result"). Learning counts only with CARL on (README, `EGG_CARL`).
- Giving a fact its number before, its team or the owner's own part.
- A told story written or written again (section 11), when it changes a part or a fact.

What does not: adding a project to a role while it holds no fact, where a side project lives, changing
a role's location, a verdict on a line of How you work, a suggestion not kept, an
answer of "There was none" or "I don't know", a skill's mark, the review of the skills list, and a Save that changes
nothing. A skill's mark and the review write no resume again; once the list is reviewed, each unsent resume's Skills
line is written again from the list, with no model, once no mark has been saved for 2 minutes (section 9). The studio waits 15 minutes after the last
change by hand, the last Keep or used result, and the last answer to a question, so one sitting of edits causes one
rewrite.

How the record is used when a resume or a message is written: a project of a role is context for its facts, never
evidence. Numbers that no fact holds are left out of what the writer is given, and a number on a resume must stand in a
fact of that employer. A bullet may print words of its project's Context in its opening clause and of its Learning in
a short closing clause, only when the bullet cites a fact of that project. The lines of How you work the owner kept
help the writer choose which facts lead, are sent without their numbers, and are never printed. A message to someone at
a company may also use the Learning of the projects behind the application.

Two known behaviours: a source read again gives its facts new reference numbers; a project deleted that came from a
repository comes back, empty, when that repository is read again.

What stage 2 adds to Experience:

- **Questions for what is missing.** The studio finds what the record lacks and asks about it: where a repository
  nobody placed belongs, when a role started, a story from a job that has none yet (which leads to the job), a
  project's result (then its action, then its context, once a told story is written), and, for a measured fact an unsent job leans on, the number before and the owner's
  own part. Experience says "The studio has N questions about this record" in one line and lists them on request,
  each leading to its item. Home takes at most 7 of them at once, in that order, and at most 3 about numbers before
  and own parts. "I don't know" and "I don't remember" are answers: they are kept, and never asked again. An answer
  writes the one value it names, and nothing else. A project's Learning is never asked.
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

## 11. Telling a story

The record starts with the owner's jobs. Under each job the owner tells one story at a time: a named piece of work,
told in an interview, from which the studio writes the project's four parts and its facts (`telling.contract`,
`lib/capture.ts`, `lib/sittings.ts`, `lib/derive.ts`). A story is a project, so a job holds many. A side project is told
the same way, from its own pane.

- **Where it starts.** An open job in Experience shows "Tell a story from this job". It opens a one-field form in place,
  "Name the piece of work in a few words.", with Add and Cancel, like the other in-place forms. Add makes the project
  under the job and starts its first sitting. A story is added only under a real job: a side project, or a repository's
  project, is told from its own project. An open project shows one plain action: "Tell this project" when nothing
  is told yet, "Carry on telling it" while a sitting is open or some questions are still open, and "Told on 19 Nov
  2026" with "Read it" once all 14 questions are answered or closed. A job is no longer told on its own.
- **The questions.** Fourteen fixed questions, asked one at a time in CARL order, each filling one part. Context: the
  setting, and what was happening just before. Action: the owner's own part, a normal week, a choice between options,
  the hardest part, and who they worked with. Result: what changed, a number, date or user that shows it, what anyone
  said, and the view from a manager's or a teammate's seat. Learning: something that went wrong, and what they
  learned. Last, "What should I have asked that I didn't?". Four fixed follow-ups come by rule. A later sitting starts
  with a reminder that quotes the project's name.
- **The screen.** A sitting has its own address (`/record/tell/:id`), so a reload lands on it. The opening line says, in
  fixed words, that the answers are kept word for word and that the studio writes the story's four parts and its facts
  from them afterwards, which the owner can then change. The conversation shows in order: the interviewer's lines in the
  light weight, the owner's answers in the heavy weight, stepped in, with their spaces and line breaks as typed. Under
  it are one quiet line that names the part ("Context · question 2 of 14"), one text field, Send (the main action), "I
  don't know" and "Stop for now". "I don't know" sends exactly those words and closes the question for good. After a
  sitting ends, the screen shows the closing line and "What you said": every answer about the project, from every
  sitting, under its question. Each answer has Delete, and the sitting has "Delete this sitting"; both are red and ask
  first. Delete on an answer takes the answers to its follow-ups with it.
- **One answer per question.** Send carries the question it answers. A second send for the same question is refused
  with "That question was already answered. Here is where the sitting stands.", with the draft kept.
- **The owner's words.** An answer is stored exactly as typed: nothing is trimmed, corrected or given curly quotes.
- **Deriving.** When a sitting ends, by the last question or by "Stop for now", and it holds an answer that is not
  "I don't know", the project is queued to be written. "Write it again from what you said" queues it by hand. It is
  slow work: a row in Activity ("Reading what you said", "Writing the four parts", "Checking it against your words"),
  with Try again on a failure, and the open screens load again when it ends. The model is given the job, the project's
  name and every answer about the project, word for word, with its question and its part. It is told that the owner
  talks freely: asides, jokes and repetition are left out, not every line is reported, and the owner's own plain words
  are kept rather than polished. It returns the four parts (one to three sentences each, or nothing) and at most eight
  facts, each with one to three passages copied from the answers.
- **What code checks.** Nothing the model writes is trusted. A fact is dropped when it quotes no passage of three words
  or more found, character for character, in the answer it names; when its passages hold none of the words of its own
  sentence (four letters or more, not a common word) or of its numbers; when its kind is unknown or its sentence empty
  or too long; when it says what another fact already says; and when it holds a number the owner did not say. That
  number check is stricter than a resume's: every run of digits (years, dates, durations, versions and digit ordinals
  such as "1st" too) must stand in the owner's answers about this project as the same number with the same magnitude
  ("50k", "$2.5M", "3 million") and the same unit sign (%, a currency sign, "x" or "times"), and every number or quantity
  word (zero to twenty, the tens, hundred, thousand, million and billion and their plurals, dozen, dozens, half, halve,
  halved, halving, quarter, third, double, doubled, doubling, triple, tripled, tripling, quadruple, quadrupled, twice,
  couple, and any word ending in "-fold") must stand there as the same word. Ordinal words ("first", "second") are
  ordinary speech and are not counted. A part with
  such a number is not written. A skill is kept only when the owner named it, as whole words, in those answers. The
  line under the facts and the Activity row say how many were left out and why ("1 fact was left out: it held a number
  you did not say."). Only the prompt, not code, keeps names, employers, tools and outcomes in the parts to what the
  owner said.
- **What is never overwritten.** A part is written only while it still holds what deriving last wrote, or is empty and
  was never written by deriving. A part the owner typed, edited, answered on Home or cleared stays as the owner left
  it: an empty part that deriving had written was cleared on purpose, and stays empty. The project's name is the
  owner's and is never replaced. Derived facts are proposed: deriving again replaces them. A fact the owner edited or
  marked is theirs (confirmed) and stays, and a new fact with its words is left out. A fact the owner deleted stays out.
  A source reading, the folding of duplicates and the rewording tool never change or delete a told fact; Talk may
  reword one, which makes it the owner's and drops the passages it quoted.
- **What the owner sees.** Under a project's facts, one quiet line: "Written from what you told on 16 Nov 2026.", with
  "Read what you said". While it waits or runs, one line in the Activity style, with no spinner. Whenever the project
  holds an answer and no writing waits or runs, "Write it from what you said" writes it ("Write it again from what you
  said" once it has been written). A fact written from a story shows, in its own pane, the passages it quotes under "You said". These
  are the owner's own words about their own work, its evidence; this is not the mark of where a value came from that
  section 8 rules out.
- **Deleting.** Deleting an answer or a sitting deletes the passages facts quote from it, and queues the story to be
  written again from what is left, so a fact or a part that rested on those words goes unless the rest still holds it.
  With nothing left, what deriving wrote is cleared and no model is asked.
- **After it is written.** A part left empty is asked on Home ("What came of …?"), as for any project, except while its
  story waits to be written or is being written. An answer there is written over the part even if deriving filled it
  meanwhile, and is the owner's from then on. A job with no story raises one Home item, "Tell a story from <title> at
  <employer>.", that opens the job.


## 12. Stories

The owner gets ready for interviews by telling each piece of work in the CARL form, short enough to say in three and a
half minutes, and by practising it aloud. Stories keeps every story in one place for that (`stories.contract`,
`lib/stories.ts`, `lib/spoken.ts`). A story is a project: nothing here is a second copy of the record.

- **Where it is.** Record's second line has "Stories" after Experience. The list is at `/record/stories` and an open story
  at `/record/stories/:id`, so a reload lands on it. On a window 1040px wide or more (Experience's breakpoint) the list
  is on the left and the open story on the right. On a narrower window the list is its own screen and a story opens as
  another, with "Back to stories".
- **The list.** Every project with a spoken story or at least one of its four parts, grouped under its job (jobs newest
  first), then side projects, then projects not placed yet. Each row is the story's reference and title, and one quiet
  line: its spoken time and "Practised 3 times, last on 19 Nov 2026" or "Not practised yet" ("No spoken story yet"
  in place of the time). A project with nothing to tell is not listed; one quiet line under the list counts them, with
  a link to Experience.
- **The spoken story.** One text in the first person, in CARL order, written to be said aloud. It is stored on the
  project (`projects.spoken`). The owner asks for it with "Write the spoken story" ("Write it again" once written). It is
  never written on its own. It is refused in plain words when the project has neither an answer from telling nor a
  part, and while the story is being written from what the owner said ("The story is being written from what you said.
  Ask again when it is done."), since its parts may still hold a number from an answer deleted since. It is slow work: a row in Activity, kind `write-spoken` ("Reading the story and what you said", "Writing the
  spoken story", "Checking it against your words"), with Try again on a failure, and the open screens load again when
  it ends. The model (`EGG_SPOKEN_MODEL`, else `EGG_MODEL`, else `opus`) is given the job, the project's title, the four
  parts and the facts as they stand, and every answer about the project word for word. It is told the order (the
  context in two or three sentences, what the owner did and decided at most length, the result, what they learned in
  one or two sentences), to write plain spoken sentences with no headings, lists or labels, to keep the owner's own
  vivid phrases and leave out asides, never to invent, round up or infer a number, name, date, tool or outcome, to add
  no praise, and to stay under 450 words. It is given the wording rules (`WRITING`), with a line that a spoken story may
  say "I" and "we".
- **What code checks.** A text is refused whole, never repaired, when it holds a number that does not stand in the
  same form in the owner's answers about the project or in its parts and facts as they stand (deriving's strict check,
  section 11, which reads a magnitude such as "50k" or "$2.5M" as part of its number; a number the owner typed into a
  part is the owner's own), when it is over 520 words, or when a line is a heading, a list item, a quote mark, Markdown
  bold or italic, a label, a line ending with a colon that no quotation follows, or a few words with no closing mark
  before a blank line. A refused text is asked for once more in the same run ("Writing it again"), with a paragraph that
  says what was refused and why. Refused again, it is not stored, and the Activity row says why ("The spoken story was not
  kept. It held a number you did not say: “80%”.").
- **What is never overwritten.** The text is written only while it still holds what the writer last wrote
  (`projects.spoken_wrote`). A text the owner edited, typed or cleared is theirs. "Write it again" then asks first,
  because the owner's text would be kept and nothing would change: the dialog offers "Replace my edit", which lets the
  next text that passes the checks replace theirs (`projects.spoken_replace`). A failure or a refused text takes that
  back, so the owner's text is protected again and Try again asks again. A text the owner saves while it is being
  written is kept over what the writer then writes.
- **The open story.** The title, the job in a quiet line, and the spoken text, set to be read aloud: the `text` size,
  with looser leading and a narrower column than running text (`readingLook()` in `look.contract`), so no third size
  is needed. Under it, one quiet line with the time: "About 2 min 40 s when spoken." The time is counted in code from
  the word count at 140 words a minute (`WORDS_PER_MINUTE` in `lib/spoken.ts`), rounded to 10 seconds. Over 3 min 30 s
  the line says "About 4 min 10 s when spoken. Aim for 3 min 30 s or less." and is drawn heavy, as a serious finding
  is. Then the actions: "I practised this", "Time it", "Edit" (in place, with Save and Cancel; a save makes it the
  owner's text) and "Write it again". With no spoken text yet, the four parts come first, then "Write the spoken story".
- **Practice.** "I practised this" records one practice with today's date. "Time it" counts the seconds up while the
  owner reads aloud; Stop records the practice with its time, and the time line then ends with "Last timed at 3 min 05
  s.". The practices are one quiet line; "Show them" lists them, each with Delete, which asks first. Practices are rows
  of `story_practice` and go with their project.
- **The four parts.** Under the practices, Context, Action, Result and Learning as the project holds them, read-only,
  with "Open in Experience".
- **Questions from real interviews.** After an interview the owner notes the questions they were asked
  (`interview_questions`). On a job whose outcome is Interviewed, Rejected or Offer, "Questions you were asked" lists
  them and has "Add a question you were asked", a one-field form in place. Each question shows the story that answers
  it in a select ("No story yet" until one is chosen), "No story needed", and Delete, which asks first. Stories lists
  every question, newest first, with its job in a quiet line, and adds a question with no job. An open story lists
  "Questions this answers". A question with no story and not marked "No story needed" is one Home item, "You were asked
  “…” and no story answers it yet.", whose action opens the question on Stories.
- **What stays.** The questions are part of the job tracker's history. Deleting a job keeps its questions with no job;
  deleting a project keeps its questions with no story; starting a new record keeps them and clears their stories.
  Practices and spoken stories go with the record.
