import type { Answer, Result, Sources } from './app.contract.d.ts';

// The server's address: this machine's by default (server.ts listens there). A build for the
// standing machine sets API_BASE_URL to its Tailscale address (app.json's env, .env.local).
const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
// A picked file is a copy under app:/tmp/picked, read here to upload it.
export const grants = `net.fetch ${API}\nfs.read app:/tmp/picked`;

const UNREACHABLE = 'The studio can’t be reached right now. Try again in a moment.';
const headers = { 'content-type': 'application/json' };

// A read: a failure fails its resource, so the app keeps the last answer it had.
async function get(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { exactTimeout: 10000, headers });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return res.json();
}

// A write: a refusal or a lost server is a reply in words, so a sheet keeps what was typed.
async function write(method: string, path: string, body?: unknown): Promise<Result<'removeFact'>> {
  try {
    const res = await fetch(`${API}${path}`, { method, exactTimeout: 10000, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return { ok: true, error: '' };
    const said = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { ok: false, error: typeof said.error === 'string' ? said.error : 'The server had a problem. Try again.' };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e; // no server at build
    return { ok: false, error: UNREACHABLE };
  }
}

// A write whose reply carries data (a draft, notes): its JSON body, or a refusal in words.
async function exchange(method: string, path: string, body: unknown, timeout = 10000): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}${path}`, { method, exactTimeout: timeout, headers, body: JSON.stringify(body) });
    const said = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, body: said };
    return { ok: false, error: typeof said.error === 'string' ? said.error : 'The server had a problem. Try again.' };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e;
    return { ok: false, error: UNREACHABLE };
  }
}

// The deployed studio's own controls. Its Worker answers ${API}/_studio/... itself (studio/worker/studio.ts), and
// forwards only content-type and accept, so every write is a POST with a JSON body. Here, with no Worker, server.ts
// has no such path: it answers 404 without CORS, which the browser reports as a network failure. So a network failure
// while the server itself answers means "not available here"; one while it does not means the server is unreachable.
type Studio = { kind: 'ok'; body: Record<string, unknown> } | { kind: 'absent' } | { kind: 'starting'; error: string } | { kind: 'timeout' } | { kind: 'refused'; error: string } | { kind: 'unreachable' };
const STARTING = 'The machine is starting. Try again in a moment.';
const ABSENT = 'This works only in the deployed studio.';
const SLOW = 'The machine did not answer in time. It may still be working: check again in a moment.';
const sentence = (s: string) => (s === '' ? '' : `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`);
async function serverAnswers(): Promise<boolean> {
  try { return (await fetch(`${API}/public`, { exactTimeout: 10000, headers })).ok; } catch (e) { if ((e as { code?: string }).code === 'bake') throw e; return false; }
}
async function studio(method: 'GET' | 'POST', path: string, body: unknown, timeout: number): Promise<Studio> {
  let res: Response;
  try {
    res = await fetch(`${API}/_studio${path}`, { method, exactTimeout: timeout, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e;
    if ((e as { kind?: string }).kind === 'Timeout') return { kind: 'timeout' };
    return (await serverAnswers()) ? { kind: 'absent' } : { kind: 'unreachable' };
  }
  if (res.status === 404) return { kind: 'absent' };
  const said = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // 503: the machine is starting, or (a write) a refusal the Worker words itself, such as publishing not being set up.
  if (res.status === 503) return { kind: 'starting', error: sentence(text(said.error)) };
  if (res.ok && said.ok !== false) return { kind: 'ok', body: said };
  return { kind: 'refused', error: sentence(text(said.error) || text(said.reason)) || 'The machine had a problem. Try again.' };
}
// A write to the machine as a reply in words.
const outcome = (r: Studio, note = ''): Result<'backupNow'> =>
  r.kind === 'ok' ? { ok: true, error: '', note }
  : { ok: false, note: '', error: r.kind === 'absent' ? ABSENT : r.kind === 'starting' ? r.error || STARTING : r.kind === 'timeout' ? SLOW : r.kind === 'refused' ? r.error : UNREACHABLE };
// A read of the machine: here, not here, or starting; anything else fails the resource.
const reached = (r: Studio): { where: 'here' | 'absent' | 'starting'; body: Record<string, unknown> } => {
  if (r.kind === 'ok') return { where: 'here', body: r.body };
  if (r.kind === 'absent' || r.kind === 'starting') return { where: r.kind, body: {} };
  // The reason is the failure's code, which the screen shows as it is.
  const reason = r.kind === 'refused' ? r.error : r.kind === 'timeout' ? SLOW : UNREACHABLE;
  throw Object.assign(new Error(reason), { reason });
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
// An exact time in words, '' for none.
const when = (ms: number) => (ms > 0 ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(ms) : '');
// One note per line: a line that matches several checks lists them together ("money; a link or an address").
const notesOf = (v: unknown) => (Array.isArray(v) ? v : []).map((n) => obj(n) ?? {}).map((n) => ({ line: num(n.line), kind: text(n.kind), text: text(n.text) }))
  .reduce<{ line: number; kind: string; text: string }[]>((all, n) => {
    const last = all[all.length - 1];
    if (last && last.line === n.line) last.kind = `${last.kind}; ${n.kind}`; else all.push({ ...n });
    return all;
  }, []);
const loginOf = (v: unknown): Result<'loadSystem'>['login'] => {
  const l = obj(v) ?? {};
  // Only a web address is offered as a link.
  return { state: text(l.state), url: /^https:\/\//i.test(text(l.url)) ? text(l.url) : '', code: text(l.code), detail: text(l.detail) };
};
const check = (v: unknown) => { const c = obj(v); return { state: c === null ? '' : typeof c.state === 'string' ? c.state : c.ok === true ? 'ok' : 'failed', detail: c === null ? '' : text(c.detail) }; };
const rows = (v: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(v)) throw new Error('The server returned something that isn’t a list.');
  return v as Record<string, unknown>[];
};
const id = (v: string) => encodeURIComponent(v);
// The profile's Markdown as parts the screen sets in its two sizes: each heading with the paragraphs and list items
// under it, the inline marks (bold, italic, code, a link's address) taken out. The words are kept as written.
const plain = (t: string) => t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/\*(\S(?:.*?\S)?)\*/g, '$1').replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|[.,;:!?]|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').trim();
function partsOf(body: string): { head: string; lines: { kind: string; text: string }[] }[] {
  const parts: { head: string; lines: { kind: string; text: string }[] }[] = [{ head: '', lines: [] }];
  let para: string[] = [];
  const last = () => parts[parts.length - 1];
  const end = () => { if (para.length > 0) last().lines.push({ kind: 'para', text: plain(para.join(' ')) }); para = []; };
  for (const line of body.split('\n')) {
    const head = /^#{1,6}\s+(.*)$/.exec(line), item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (line.trim() === '' || /^\s*(---+|\*\*\*+)\s*$/.test(line)) end();
    else if (head) { end(); parts.push({ head: plain(head[1]), lines: [] }); }
    else if (item) { end(); last().lines.push({ kind: 'item', text: plain(item[1]) }); }
    else para.push(line.trim());
  }
  end();
  return parts.map((p) => ({ head: p.head, lines: p.lines.filter((l) => l.text !== '') })).filter((p) => p.head !== '' || p.lines.length > 0);
}
// A flag's severity, the most serious first.
const SEVERITY = ['high', 'warn', 'info'];

const sources: Sources = {
  loadBank: async (): Promise<Result<'loadBank'>> => {
    const b = (await get('/bank')) as { roles?: unknown; facts?: unknown };
    return {
      loaded: true,
      roles: rows(b.roles).map((r) => ({ id: text(r.id), name: text(r.name), period: text(r.period), start: text(r.start), end: text(r.end), standing: text(r.standing), reach: text(r.reach), employer: r.employer === true, partOf: text(r.partOf), partOfName: text(r.partOfName) })),
      places: rows((b as { places?: unknown }).places ?? []).map((r) => ({ id: text(r.id), name: text(r.name) })),
      facts: rows(b.facts).map((f) => ({ id: text(f.id), roleId: text(f.roleId), kind: text(f.kind), text: text(f.text), detail: text(f.detail), metric: text(f.metric),
        skills: text(f.skills), evidence: text(f.evidence), source: text(f.source), added: text(f.added), edited: f.edited === true })),
    };
  },
  // A waiting source's place: the worker reads one source at a time, the oldest first, so what is ahead of it is the
  // one being read and every older one still waiting (-1 when it is not waiting).
  loadSources: async (): Promise<Result<'loadSources'>> => {
    const list = rows(await get('/sources')).map((s) => ({ id: text(s.id), kind: text(s.kind), title: text(s.title), detail: text(s.detail),
      status: text(s.status), note: text(s.note), facts: typeof s.facts === 'number' ? s.facts : 0 }));
    const ahead = (s: { id: string; status: string }) => s.status !== 'queued' ? -1
      : list.filter((x) => x.status === 'running' || (x.status === 'queued' && Number(x.id) < Number(s.id))).length;
    return { loaded: true, items: list.map((s) => ({ ...s, ahead: ahead(s) })) };
  },
  loadInbox: async (): Promise<Result<'loadInbox'>> => {
    const b = (await get('/inbox')) as { folder?: unknown; files?: unknown };
    return { folder: text(b.folder), files: rows(b.files).map((f) => text(f)) };
  },
  loadProfile: async (): Promise<Result<'loadProfile'>> => {
    const p = (await get('/profile')) as Record<string, unknown>;
    return { loaded: true, status: text(p.status), note: text(p.note), body: text(p.body), parts: partsOf(text(p.body)), gaps: rows(p.gaps).map((g) => text(g)),
      stale: p.stale === true, written: text(p.written), facts: typeof p.facts === 'number' ? p.facts : 0 };
  },
  // Listing every repository can take a while the first time; the server keeps the answer.
  loadGithub: async (): Promise<Result<'loadGithub'>> => {
    const res = await fetch(`${API}/github`, { exactTimeout: 60000, headers });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const h = (await res.json()) as Record<string, unknown>;
    return { loaded: true, connected: h.connected === true, login: text(h.login), error: text(h.error), owners: rows(h.owners).map((o) => text(o)),
      repos: rows(h.repos).map((r) => ({ full: text(r.full), owner: text(r.owner), name: text(r.name), detail: text(r.detail), added: r.added === true, extra: r.extra === true })) };
  },
  addGithub: ([repos]) => write('POST', '/sources/github', { repos }),
  loadJobs: async (): Promise<Result<'loadJobs'>> => ({ loaded: true,
    items: rows(await get('/jobs')).map((j) => ({ id: text(j.id), title: text(j.title), company: text(j.company), place: text(j.place), status: text(j.status), note: text(j.note), fit: typeof j.fit === 'number' ? j.fit : -1, outcome: text(j.outcome),
      stage: text(j.stage) || 'saved', salary: text(j.salary), posted: text(j.posted), added: text(j.added), contact: text(j.contact) })) }),
  // The job a route shows; none is selected while the list alone is on screen.
  loadJob: async ([job]): Promise<Result<'loadJob'>> => {
    const none = { loaded: false, id: '', url: '', title: '', company: '', place: '', status: '', note: '', fit: -1, outcome: '', outcomeNote: '', contact: '', pdf: '', pages: 2, atsOk: false, atsScore: -1, atsRequired: 85, atsParts: '', ats: [], covered: 0, asked: 0, verdict: '', strengths: [], risks: [], changes: [], gaps: [], resume: '', requirements: [], weighed: false, termsIn: [], termsBank: [], termsMissing: [], knockouts: [], checks: [], resumeStatus: '', resumeNote: '', resumeStale: false, doors: [], doorsStatus: '', doorsNote: '', edited: false, reviewScore: '', reviewPassed: false, reviewRounds: 0, seats: [], reviewChanges: [], flags: [], skimConclusion: '' };
    if (job === '') return none;
    const j = (await get(`/jobs/${id(job)}`)) as Record<string, unknown>;
    const list = (v: unknown) => rows(v ?? []).map((x) => text(x));
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    return { loaded: true, id: text(j.id), url: text(j.url), title: text(j.title), company: text(j.company), place: text(j.place), status: text(j.status), note: text(j.note),
      fit: typeof j.fit === 'number' ? j.fit : -1, outcome: text(j.outcome), outcomeNote: text(j.outcomeNote), contact: text(j.contact), pdf: text(j.pdf) === '' ? '' : `${API}${text(j.pdf)}`, pages: j.pages === 1 ? 1 : 2, atsOk: j.atsOk === true,
      atsScore: typeof j.atsScore === 'number' ? j.atsScore : -1, atsRequired: typeof j.atsRequired === 'number' ? j.atsRequired : 85, atsParts: text(j.atsParts),
      ats: rows(j.ats ?? []).map((a) => ({ id: text(a.id), label: text(a.label), ok: a.ok === true, note: text(a.note) })), covered: n(j.covered), asked: n(j.asked), verdict: text(j.verdict), strengths: list(j.strengths), risks: list(j.risks), changes: list(j.changes), gaps: list(j.gaps), resume: text(j.resume),
      weighed: j.weighed === true, termsIn: list(j.termsIn), termsBank: list(j.termsBank), termsMissing: list(j.termsMissing),
      checks: rows(j.checks ?? []).map((c) => ({ id: text(c.id), question: text(c.question), answer: text(c.answer), note: text(c.note) })),
      knockouts: rows(j.knockouts ?? []).map((k) => ({ id: text(k.id), question: text(k.question), answer: text(k.answer), note: text(k.note) })),
      doors: rows(j.doors ?? []).map((d) => ({ id: text(d.id), to: text(d.to), find: text(d.find), why: text(d.why), message: text(d.message) })), resumeStatus: text(j.resumeStatus), resumeStale: j.resumeStale === true, resumeNote: text(j.resumeNote), doorsStatus: text(j.doorsStatus), doorsNote: text(j.doorsNote), edited: j.edited === true, reviewScore: text(j.reviewScore), reviewPassed: j.reviewPassed === true, reviewRounds: n(j.reviewRounds), seats: rows(j.seats ?? []).map((x) => ({ id: text(x.id), seat: text(x.seat), model: text(x.model), score: text(x.score), note: text(x.note) })), reviewChanges: list(j.reviewChanges),
      requirements: rows(j.requirements ?? []).map((r) => ({ id: text(r.id), text: text(r.text), must: r.must === true, coverage: text(r.coverage), evidence: text(r.evidence), basis: text(r.basis), counted: typeof r.counted === 'number' ? r.counted : -1 })),
      // The serious flags first; the server keeps each severity's own order.
      flags: rows(j.flags ?? []).map((f) => ({ id: text(f.id), kind: text(f.kind), severity: text(f.severity), text: text(f.text), items: list(f.items) }))
        .sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity)),
      skimConclusion: text(obj(j.skim)?.conclusion) };
  },
  loadLeads: async (): Promise<Result<'loadLeads'>> => {
    const d = (await get('/leads')) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    return { loaded: true, status: text(d.status), note: text(d.note), unlisted: num(d.unlisted), underPay: num(d.underPay), companies: num(d.companies), unscored: num(d.unscored), checked: text(d.checked),
      items: rows(d.items).map((l) => ({ id: text(l.id), title: text(l.title), company: text(l.company), place: text(l.place), score: num(l.score), reason: text(l.reason), salary: text(l.salary), posted: text(l.posted), fresh: l.fresh === true })) };
  },
  loadLead: async ([lead]): Promise<Result<'loadLead'>> => {
    if (lead === '') return { loaded: false, id: '', title: '', company: '', place: '', url: '', score: 0, reason: '', posting: '' };
    const l = (await get(`/leads/${id(lead)}`)) as Record<string, unknown>;
    return { loaded: true, id: text(l.id), title: text(l.title), company: text(l.company), place: text(l.place), url: text(l.url), score: typeof l.score === 'number' ? l.score : 0, reason: text(l.reason), posting: text(l.posting) };
  },
  loadCompanies: async (): Promise<Result<'loadCompanies'>> => ({ loaded: true,
    items: rows(await get('/companies')).map((c) => ({ id: text(c.id), name: text(c.name), board: text(c.board), open: typeof c.open === 'number' ? c.open : 0, note: text(c.note) })) }),
  readLead: ([lead]) => write('POST', `/leads/${id(lead)}/read`),
  dismissLead: ([lead]) => write('POST', `/leads/${id(lead)}/dismiss`),
  addCompany: ([link]) => write('POST', '/companies', { link }),
  removeCompany: ([company]) => write('DELETE', `/companies/${id(company)}`),
  checkWatchlist: () => write('POST', '/leads/check'),
  rewriteResume: ([job]) => write('PATCH', `/jobs/${id(job)}`, { rewrite: true }),
  setLength: ([job, pages]) => write('PATCH', `/jobs/${id(job)}`, { pages: pages === '1' ? 1 : 2 }),
  setOutcome: ([job, outcome]) => write('PATCH', `/jobs/${id(job)}`, { outcome, picked: true }),
  saveContact: ([job, who]) => write('PATCH', `/jobs/${id(job)}`, { contact: who }),
  // Printing the PDF again can take a few seconds.
  saveResume: async ([job, body]) => { try { const res = await fetch(`${API}/jobs/${id(job)}`, { method: 'PATCH', exactTimeout: 60000, headers, body: JSON.stringify({ resume: body }) }); if (res.ok) return { ok: true, error: '' }; const said = (await res.json().catch(() => ({}))) as { error?: unknown }; return { ok: false, error: typeof said.error === 'string' ? said.error : 'The server had a problem. Try again.' }; } catch (e) { if ((e as { code?: string }).code === 'bake') throw e; return { ok: false, error: UNREACHABLE }; } },
  saveOutcome: ([job, outcome, note, picked]) => write('PATCH', `/jobs/${id(job)}`, { outcome, note, picked: picked === 'picked' }),
  addJob: ([url, posting]) => write('POST', '/jobs', { url, posting }),
  readJob: ([job]) => write('POST', `/jobs/${id(job)}/read`),
  draftOutreach: ([job]) => write('POST', `/jobs/${id(job)}/outreach`),
  removeJob: ([job]) => write('DELETE', `/jobs/${id(job)}`),
  loadPerson: async (): Promise<Result<'loadPerson'>> => { const p = (await get('/person')) as Record<string, unknown>; return { loaded: true, name: text(p.name), location: text(p.location), email: text(p.email), phone: text(p.phone), website: text(p.website), github: text(p.github), linkedin: text(p.linkedin) }; },
  savePerson: ([name, location, email, phone, website, github, linkedin]) => write('POST', '/person', { name, location, email, phone, website, github, linkedin }),
  loadTalk: async (): Promise<Result<'loadTalk'>> => {
    const t = (await get('/talk')) as Record<string, unknown>;
    return { loaded: true, busy: t.busy === true,
      messages: rows(t.messages ?? []).map((m) => ({ id: text(m.id), mine: m.mine === true, body: text(m.body), status: text(m.status), note: text(m.note), added: rows(m.added ?? []).map((x) => text(x)) })),
      questions: rows(t.questions ?? []).map((q) => ({ id: text(q.id), text: text(q.text), from: text(q.from) })) };
  },
  // Two roles that both say Present, while the person has not said how they relate: the open questions about them.
  loadOverlaps: async (): Promise<Result<'loadOverlaps'>> => {
    const q = (await get('/questions')) as { questions?: unknown };
    return rows(q.questions ?? []).map((x) => text(x.key).split(':')).filter((k) => k[0] === 'two-current' && k.length === 3).map((k) => ({ a: k[1], b: k[2] }));
  },
  // Home: what needs the person (GET /queue). An answer or a snooze replies with the item's key, so a refusal
  // finds its item again.
  loadQueue: async (): Promise<Result<'loadQueue'>> => {
    const q = (await get('/queue')) as Record<string, unknown>;
    return { loaded: true, snoozed: typeof q.snoozed === 'number' ? q.snoozed : 0,
      items: rows(q.items).map((i) => ({ key: text(i.key), kind: text(i.kind), text: text(i.text), from: text(i.from), blocks: text(i.blocks),
        choices: rows(i.choices ?? []).map((c) => text(c)), inputs: rows(i.inputs ?? []).map((c) => text(c)), route: text(i.route) })) };
  },
  answerQuestion: async ([key, choice, value]): Promise<Result<'answerQuestion'>> => ({ ...(await write('POST', '/questions', { key, choice, value })), key }),
  snoozeQueueItem: async ([key]): Promise<Result<'snoozeQueueItem'>> => ({ ...(await write('POST', '/queue/snooze', { key })), key }),
  sendTalk: ([body]) => write('POST', '/talk', { body }),
  askTalk: ([question]) => write('POST', '/talk', { question }),
  clearTalk: () => write('DELETE', '/talk'),
  loadDirection: async (): Promise<Result<'loadDirection'>> => ({ loaded: true, body: text(((await get('/direction')) as { body?: unknown }).body) }),
  saveDirection: ([body]) => write('POST', '/direction', { body }),
  askProfile: () => write('POST', '/profile/write'),
  // The public collection. A draft and notes save nothing; only Save does.
  loadPublic: async (): Promise<Result<'loadPublic'>> => {
    const p = (await get('/public')) as Record<string, unknown>;
    return { loaded: true, text: text(p.text), savedAt: num(p.savedAt), savedWhen: when(num(p.savedAt)), sha256: text(p.sha256), notes: notesOf(p.notes) };
  },
  draftPublic: async (): Promise<Result<'draftPublic'>> => {
    const r = await exchange('POST', '/public/draft', {});
    return r.ok ? { ok: true, error: '', text: text(r.body.text), notes: notesOf(r.body.notes) } : { ok: false, error: r.error, text: '', notes: [] };
  },
  checkPublic: async ([body]): Promise<Result<'checkPublic'>> => {
    const r = await exchange('POST', '/public/notes', { text: body });
    return r.ok ? { ok: true, error: '', text: body, notes: notesOf(r.body.notes) } : { ok: false, error: r.error, text: '', notes: [] };
  },
  savePublic: ([body]) => write('POST', '/public/save', { text: body }),
  // What the public page answers from now: the Worker's, so 404 here.
  loadLive: async (): Promise<Result<'loadLive'>> => {
    const { where, body } = reached(await studio('GET', '/public', undefined, 30000));
    const live = obj(body.live);
    const at = live ? Date.parse(text(live.publishedAt)) : NaN;
    return { loaded: true, where, live: live !== null, sha256: live ? text(live.sha256) : '', publishedAt: Number.isFinite(at) ? at : 0, publishedWhen: Number.isFinite(at) ? when(at) : '' };
  },
  // Publishing may wait for the machine to start.
  publishPublic: async ([sha256]) => outcome(await studio('POST', '/publish', { sha256 }, 180000)),
  unpublishPublic: async () => outcome(await studio('POST', '/unpublish', {}, 180000)),
  // The machine: its backups, the model's sign-in and its programs.
  loadSystem: async (): Promise<Result<'loadSystem'>> => {
    const { where, body } = reached(await studio('GET', '/status', undefined, 30000));
    const k = obj(body.keeper), c = obj(body.container), st = obj(k?.selfTest), lb = obj(k?.lastBackup), from = k?.restoredFrom;
    const phase = text(k?.phase);
    const machine = where !== 'here' ? '' : c && c.running === false ? 'stopped' : k === null || phase === 'restoring' ? 'starting' : phase;
    const fromAt = num(obj(from)?.createdAt), fromKey = typeof from === 'string' ? from : text(obj(from)?.key);
    const llm = obj(k?.llm), signedIn = check(st?.codexSignedIn), sandbox = check(st?.codexSandbox);
    const programs = Object.entries(obj(st?.programs) ?? {}).map(([name, v]) => ({ name, ok: obj(v)?.ok === true, detail: text(obj(v)?.detail) }));
    const startedAt = num(k?.startedAt), lastUsedAt = num(body.lastActivityAt), backupAt = num(lb?.at), unsavedSince = num(k?.unsavedSince);
    return { loaded: true, where, machine, keeper: k !== null, note: text(k?.note),
      startedAt, startedWhen: when(startedAt), lastUsedAt, lastUsedWhen: when(lastUsedAt), backupAt, backupWhen: when(backupAt),
      backupError: text(k?.lastBackupError), unsaved: k?.unsaved === true, unsavedSince, unsavedWhen: when(unsavedSince),
      startedFrom: from === 'empty' ? 'An empty start, with no backup' : fromAt > 0 ? `The backup made ${when(fromAt)}` : fromKey !== '' ? `The backup named ${fromKey}` : '',
      llm: llm === null ? '' : llm.ok === true ? 'ok' : 'failed', llmDetail: text(llm?.detail),
      signedIn: signedIn.state, signedInDetail: signedIn.detail, sandbox: sandbox.state, sandboxDetail: sandbox.detail,
      login: loginOf(k?.codexLogin ?? body.codexLogin), programs };
  },
  // A backup can take up to five minutes.
  backupNow: async () => {
    const r = await studio('POST', '/backup', {}, 330000);
    return outcome(r, r.kind === 'ok' && text(r.body.reason) !== '' ? sentence(text(r.body.reason)) : 'Backed up.');
  },
  // A sleeping machine is started first, which can take about 80 seconds.
  // Its reply holds the one-time code, which is dropped here: the screen shows the code only from the latest status.
  codexLogin: async () => outcome(await studio('POST', '/codex/login', {}, 150000)),
  codexCancel: async () => outcome(await studio('POST', '/codex/cancel', {}, 30000)),
  saveFact: ([fact, body, detail, metric, roleId, kind]) => write('PATCH', `/facts/${id(fact)}`, { text: body, detail, metric, roleId, kind }),
  saveRole: ([role, standing, reach, partOf]) => write('PATCH', `/roles/${id(role)}`, { standing, reach, partOf }),
  removeFact: ([fact]) => write('DELETE', `/facts/${id(fact)}`),
  addSource: ([kind, title, body, author]) => write('POST', '/sources', { kind, title, body, author }),
  uploadSource: async ([path, name], _store, storage) => {
    if (!path.startsWith('app:/tmp/picked/')) return { ok: false, error: 'Choose the file again.' };
    let bytes: ArrayBuffer;
    try { bytes = await storage.fs.readFile(path); } catch { return { ok: false, error: 'That file is no longer available. Choose it again.' }; }
    try {
      const res = await fetch(`${API}/sources/upload?name=${encodeURIComponent(name)}`, { method: 'POST', exactTimeout: 60000, headers: { 'content-type': 'application/octet-stream' }, body: bytes });
      if (res.ok) return { ok: true, error: '' };
      const said = (await res.json().catch(() => ({}))) as { error?: unknown };
      return { ok: false, error: typeof said.error === 'string' ? said.error : 'The server had a problem. Try again.' };
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return { ok: false, error: UNREACHABLE };
    }
  },
  readSource: ([source]) => write('POST', `/sources/${id(source)}/read`),
  removeSource: ([source]) => write('DELETE', `/sources/${id(source)}`),
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
