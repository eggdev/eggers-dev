# Design direction

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
4. **Every fact, role, job and resume is a record.** A record has a permanent reference number, a date or
   date range, and a provenance line (where it came from and when). Its fields always come in the same order:
   reference, name, dates, extent, status, provenance.
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
  line; then provenance. The field order does not change.
- On a phone the gutter takes about 70px of 390px. `refs` set to `inline` suits a phone better.
- With `notes` at 0 the notes column is not drawn, so the main column keeps the page.

## 4. Named patterns

| Name | What it is here |
| --- | --- |
| Accession number | The permanent reference on a record: `F-0142` a fact, `R-07` a role, `J-023` a job, `V-023-C` a resume version. Set in tabular figures. Never reused. |
| Provenance line | One grey line: source, then date. "From the 2024 review notes, confirmed 3 Mar 2026." |
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
- A fact or role: `Confirmed`, `Unsure`.
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

- **Role.** The official record of a job: employer, title, start, end, employment type and location. Each field
  carries where it comes from: "As HR records it", "From memory", or "Source not marked". A role also holds how far
  its work reached users. Stored in `roles`; the marks are `roles.official`.
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
- An open role shows all six fields of its official record, each with its mark. An open project shows all four parts.
- No note line at the top, and no drafts of what the studio could write.
- The values the screen uses (the first view, facts before "Show all", the step per level, the width for two
  columns) are `experienceLook()` in `look.contract`.

What was rejected, and why:

- A list of stories as the only unit: it hid the job structure, and dropped facts that belong to no story.
- Opening in place with everything open: readers lose their place in nested lists.
- A blank line as the only way to add: it captures a headline and nothing else.
- Naming every missing part on the closed line: it reads as a form to fill in.
- A completeness meter: it measures quantity, not quality.

What makes the studio write unsent resumes again (each changes what a resume is written from):

- Adding or deleting a role.
- Adding a side project.
- Renaming, re-dating or deleting a project that is a side project or comes from a repository.
- Moving a fact to another role.
- Placing a repository.
- Changing a role's title, employer, dates, employment type or whether its work reached users.
- Adding, editing or deleting a fact (its words, story, number or category).

What does not: adding a project to a role, filing a fact in a project of its own role, editing a project's four
parts, changing a role's location, setting where a field comes from, and a Save that changes nothing. The studio
waits 15 minutes after the last change by hand (as after the last answer to a question), so one sitting of edits
causes one rewrite.

Two known behaviours: a source read again gives its facts new reference numbers; a project deleted that came from a
repository comes back, empty, when that repository is read again.
