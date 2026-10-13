# Agreed product scope

The first usable release is local private Eve in Studio, building an empty career knowledge bank.
The owner and Eve revisit roles over several deep sessions: free recall first, then recurring
requirements from a broad job-description corpus. Stories retain contribution, decisions,
context, challenges and qualitative outcomes; no mandatory metrics or public verification badges.
Eve is an editing partner that asks one question at a time and pushes for useful detail without
sycophancy. Importance varies, but apparently routine work may still demonstrate capability.

Conversations persist and can resume or branch into new focused topics. Entries and an interview
map are editable. Automatic edits are default; diff review is an owner-controlled setting.
Requested deletion is real, not a soft-delete archive. Company URLs and pasted source material
can inform a conversation; richer document/code imports can follow.

Research begins with a one-off corpus of hundreds of listings per role family: software,
frontend, senior/staff software, full stack, forward deployed engineering, product management,
and technical product management, expanding as curiosity develops. NYC metro including
Fairfield County CT and remote roles available from NYC; no salary filter. Preserve the complete
requirement map and decide together when coverage is sufficient. Research is not target selection.

The owner supplies bulk URLs or captures listings from a signed-in personal browser (TrueUp
first). Fetch/extract is repeatable, deduplicated and inspectable. Extraction defaults to Luna;
interview models are configurable. Private Eve may access the web. Imported pages never have
authority to change the agent’s instructions.

Architecture: Nx + Bun, Next for Web and Studio, Eve inside Studio, Effect 4 where it improves
service reliability, PostgreSQL storage. Separate Vercel deployments with separate Neon databases. Local
subscription-backed conversations first; remote conversation auth/cost and real-time voice later.
No historical Home app, contracts, content or custom design system retained for compatibility.

Web initially displays Brendan’s name, contact information, a construction animation and a
single-launch-email signup. A later public knowledge collection will be deliberately prepared
from public website content, projects and interests. Public Eve gets only that collection,
with inexpensive inference and rate limits resolved in its own phase. Career targeting,
resume/cover-letter generation and daily discovery follow sequentially.

Application tracking is now part of Studio, separately from the research corpus. Import all
TrueUp tracker tabs, preserve explicitly confirmed stages, and never infer application or
rejection dates from relative saved ages. Jobs have editable dated timelines plus next actions
and optional due dates. Imports are idempotent and do not overwrite owner tracking changes.
The initial corpus comes from the owner’s saved/applied jobs; broader sampling follows.
