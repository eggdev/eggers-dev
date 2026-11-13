// How anything written for the person is worded, and which numbers earn a place. One text, given
// to every prompt that writes a fact, a profile or a resume, and to the council that reviews a
// resume (lib/council.ts), so they all hold the same line.

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
- A number is shown only when it would impress or orient a hiring manager: users, revenue, money or time saved at a size that matters, scale of data or traffic, team size led, a large before-and-after change.
- Leave out numbers that are small, incidental or internal bookkeeping: a count of tests written, a handful of files or endpoints, savings of a few hundred dollars, version numbers, the date something launched or was merged, how many days ago it shipped, ticket or pull-request counts.
- Never show a calendar date inside a bullet. Dates belong only on the line under a role's heading.
- Leaving a number out is always allowed. Changing one is never allowed: a number that is shown is exactly as the bank has it.
- Leave out a line whose point an outsider cannot follow, or that describes process ("restructured workflows", "added guardrails") without saying what was built and what it did for someone. Prefer the fact with a clear thing built and a clear user.
- Implementation detail (retry logic, manifests, idempotency keys, lint rules) is shown only where the posting asks for that skill, and then in one clause, not as the point of the bullet.`;

// How a resume's bullets and top are built. Each rule answers something the three readers flagged on every
// job (2026-11-12) or something the rule-based score (lib/ats.ts) takes points for.
export const BULLETS = `Bullets and the top of the page:
- Open every bullet with a past-tense verb for what the person did ("Built", "Led", "Cut", "Tech-led"). Never open with "Technical lead for", "Served as", "Responsible for", "Worked on" or "Worked with": say what was done.
- One claim per bullet. A bullet that joins two pieces of work with "and" is two bullets, or the weaker one is cut.
- Within a role, no three bullets in a row open with the same verb.
- Order inside a bullet: what was done, with what tool or method where the bank names one, then its result where the bank has one worth showing. A bullet with no result must still say what the thing was and who used it.
- A bullet that only names a stack ("Built backend APIs in Python with Django REST Framework") is never shown. If an older role has nothing better in the bank, that role is its heading and dates alone, and its technologies go in Skills.
- The first sentence of the Summary says what the person does in the posting's own words for the role, where the bank supports that work. It must not contradict the current title: a director who works as the only engineer says both.
- The two or three results that best answer this posting appear in the Summary or in the first bullets of the first role, because a first read stops there.
- No "I", "my" or "we" anywhere: a resume leaves the subject out ("Built", not "I built").
- An abbreviation the posting spells out is written both ways the first time ("Model Context Protocol (MCP)"), so a search for either finds it.
- Every statement about a role matches the bank's facts for that role exactly: who was led, what the product was, what the person owned. Do not merge two roles' work into one line.`;
