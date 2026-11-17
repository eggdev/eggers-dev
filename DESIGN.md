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
