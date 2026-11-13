import type { Answer, Result, Sources } from './app.contract.d.ts';

// The server's address: this machine's by default (server.ts listens there). A build for the
// standing machine sets API_BASE_URL to its Tailscale address (app.json's env, .env.local).
const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
// A picked file is a copy under app:/tmp/picked, read here to upload it.
export const grants = `net.fetch ${API}\nfs.read app:/tmp/picked`;

const UNREACHABLE = 'Can’t reach the server. Check that it’s running, then try again.';
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

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const rows = (v: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(v)) throw new Error('The server returned something that isn’t a list.');
  return v as Record<string, unknown>[];
};
const id = (v: string) => encodeURIComponent(v);

const sources: Sources = {
  loadBank: async (): Promise<Result<'loadBank'>> => {
    const b = (await get('/bank')) as { roles?: unknown; facts?: unknown };
    return {
      loaded: true,
      roles: rows(b.roles).map((r) => ({ id: text(r.id), name: text(r.name), period: text(r.period), standing: text(r.standing), reach: text(r.reach), employer: r.employer === true, partOf: text(r.partOf), partOfName: text(r.partOfName) })),
      places: rows((b as { places?: unknown }).places ?? []).map((r) => ({ id: text(r.id), name: text(r.name) })),
      facts: rows(b.facts).map((f) => ({ id: text(f.id), roleId: text(f.roleId), kind: text(f.kind), text: text(f.text), detail: text(f.detail), metric: text(f.metric),
        skills: text(f.skills), evidence: text(f.evidence), source: text(f.source) })),
    };
  },
  loadSources: async (): Promise<Result<'loadSources'>> => ({
    loaded: true,
    items: rows(await get('/sources')).map((s) => ({ id: text(s.id), kind: text(s.kind), title: text(s.title), detail: text(s.detail),
      status: text(s.status), note: text(s.note), facts: typeof s.facts === 'number' ? s.facts : 0 })),
  }),
  loadInbox: async (): Promise<Result<'loadInbox'>> => {
    const b = (await get('/inbox')) as { folder?: unknown; files?: unknown };
    return { folder: text(b.folder), files: rows(b.files).map((f) => text(f)) };
  },
  loadProfile: async (): Promise<Result<'loadProfile'>> => {
    const p = (await get('/profile')) as Record<string, unknown>;
    return { loaded: true, status: text(p.status), note: text(p.note), body: text(p.body), gaps: rows(p.gaps).map((g) => text(g)),
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
    const none = { loaded: false, id: '', url: '', title: '', company: '', place: '', status: '', note: '', fit: -1, outcome: '', outcomeNote: '', contact: '', pdf: '', pages: 2, atsOk: false, atsScore: -1, atsRequired: 85, atsParts: '', ats: [], covered: 0, asked: 0, verdict: '', strengths: [], risks: [], changes: [], gaps: [], resume: '', requirements: [], weighed: false, termsIn: [], termsBank: [], termsMissing: [], knockouts: [], checks: [], resumeStatus: '', resumeNote: '', resumeStale: false, doors: [], doorsStatus: '', doorsNote: '', edited: false, reviewScore: '', reviewPassed: false, reviewRounds: 0, seats: [], reviewChanges: [] };
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
      requirements: rows(j.requirements ?? []).map((r) => ({ id: text(r.id), text: text(r.text), must: r.must === true, coverage: text(r.coverage), evidence: text(r.evidence), basis: text(r.basis), counted: typeof r.counted === 'number' ? r.counted : -1 })) };
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
  sendTalk: ([body]) => write('POST', '/talk', { body }),
  askTalk: ([question]) => write('POST', '/talk', { question }),
  clearTalk: () => write('DELETE', '/talk'),
  loadDirection: async (): Promise<Result<'loadDirection'>> => ({ loaded: true, body: text(((await get('/direction')) as { body?: unknown }).body) }),
  saveDirection: ([body]) => write('POST', '/direction', { body }),
  askProfile: () => write('POST', '/profile/write'),
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
