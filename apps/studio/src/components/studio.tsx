'use client';
import type { Entry, EntryInput, Listing, Role, Workspace } from '@repo/domain/types';
import { Badge, Button, cn, Dialog, Input, Select, Switch, Textarea } from '@repo/ui';
import { MarkdownEditor } from '@repo/ui/editor';
import { api } from '@studio/components/api';
import { Chat } from '@studio/components/chat';
import { JobTracker } from '@studio/components/job-tracker';
import { diffLines } from 'diff';
import {
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  ListChecks,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import { cloneElement, isValidElement, useCallback, useEffect, useId, useState } from 'react';

const sections = [
  ['conversations', 'Conversations', MessagesSquare],
  ['knowledge', 'Knowledge bank', BookOpen],
  ['map', 'Interview map', ListChecks],
  ['research', 'Job research', Search],
  ['jobs', 'Job tracker', BriefcaseBusiness],
  ['settings', 'Settings', Settings2],
] as const;
const families = [
  'Software Engineer',
  'Frontend Engineer',
  'Senior Software Engineer',
  'Full Stack Engineer',
  'Staff Software Engineer',
  'Forward Deployed Engineer',
  'Product Manager',
  'Technical Product Manager',
];
type Section = (typeof sections)[number][0];
export function Studio() {
  const [state, setState] = useState<Workspace>();
  const [section, setSection] = useState<Section>('conversations');
  const [threadId, setThreadId] = useState<string>();
  const [trackedJobId, setTrackedJobId] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [newThread, setNewThread] = useState(false);
  const [newRole, setNewRole] = useState(false);
  const [title, setTitle] = useState('');
  const [roleId, setRoleId] = useState('');
  const [company, setCompany] = useState('');
  const [dates, setDates] = useState('');
  const [context, setContext] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const refresh = useCallback(async () => {
    try {
      setState(await api<Workspace>('workspace'));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Refresh after long-running agent work, and after returning from another tab.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [refresh]);
  const act = async (action: string, input: unknown = {}) => {
    setError('');
    try {
      const result = await api(action, input);
      if (
        action.endsWith('.delete') &&
        (action.startsWith('entries') || action.startsWith('threads') || action.startsWith('roles'))
      )
        setEpoch((n) => n + 1);
      await refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const run = (fn: () => Promise<unknown>) => {
    void fn().catch(() => {});
  };
  const createThread = async (message?: string) => {
    const thread = await act('threads.create', {
      title: message ? 'Process job research' : title.trim() || 'New conversation',
      roleId: roleId || null,
    });
    setThreadId(thread.id);
    setInitialMessage(message ?? '');
    setSection('conversations');
    setNewThread(false);
    setTitle('');
  };
  if (loading)
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        Opening Studio…
      </main>
    );
  if (!state)
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="text-xl font-semibold">Studio could not open</h1>
        <p className="my-4" role="alert">
          {error}
        </p>
        <Button onClick={() => void refresh()}>Try again</Button>
      </main>
    );
  const thread = state.threads.find((t) => t.id === threadId);
  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      <aside
        className={cn(
          'shrink-0 border-b bg-muted/40 md:border-b-0 md:border-r',
          collapsed ? 'md:w-16' : 'md:w-64',
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 px-4">
          {!collapsed && (
            <a href="/" className="font-semibold tracking-tight">
              Studio{' '}
              <span className="ml-1 text-xs font-normal text-muted-foreground">/ Brendan</span>
            </a>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        <nav aria-label="Studio" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col">
          {sections.map(([id, label, Icon]) => (
            <Button
              key={id}
              variant="ghost"
              title={label}
              className={cn(
                'justify-start',
                section === id && 'bg-accent',
                collapsed && 'md:justify-center md:px-0',
              )}
              onClick={() => setSection(id)}
              aria-current={section === id ? 'page' : undefined}
            >
              <Icon />
              {!collapsed && label}
              {id === 'knowledge' && state.proposals.length > 0 && !collapsed && (
                <Badge>{state.proposals.length}</Badge>
              )}
            </Button>
          ))}
        </nav>
        {!collapsed && (
          <div className="hidden px-4 md:block">
            <div className="mt-5 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>CONVERSATIONS</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="New conversation"
                onClick={() => setNewThread(true)}
              >
                <Plus />
              </Button>
            </div>
            <div className="mt-1 max-h-[50dvh] space-y-1 overflow-auto">
              {state.threads.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => {
                    setThreadId(t.id);
                    setInitialMessage('');
                    setSection('conversations');
                  }}
                  className={cn(
                    'block w-full truncate rounded-md px-2 py-2 text-left text-sm hover:bg-accent',
                    threadId === t.id && section === 'conversations' && 'bg-accent',
                  )}
                >
                  {t.title}
                </button>
              ))}
            </div>
            <p className="mt-8 text-xs leading-5 text-muted-foreground">
              Private workspace
              <br />
              {state.storage === 'local' ? 'Stored on this computer' : 'Connected to Postgres'}
            </p>
          </div>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 md:px-8">
          <h1 className="text-sm font-medium">{sections.find((s) => s[0] === section)?.[1]}</h1>
          <div className="flex items-center gap-2">
            <Badge>{state.settings.reviewRequired ? 'Review changes' : 'Automatic edits'}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTitle('');
                setNewThread(true);
              }}
            >
              <Plus />
              New conversation
            </Button>
          </div>
        </header>
        {state.modelConnection === 'disabled' && (
          <p className="border-b bg-muted/40 px-6 py-3 text-sm text-muted-foreground">
            Your bank is online. Interviews and job extraction run in local Studio for now.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-4 border-b bg-destructive/5 px-6 py-3 text-sm text-destructive"
          >
            {error}
            <Button size="sm" variant="ghost" onClick={() => setError('')}>
              Dismiss
            </Button>
          </div>
        )}
        <div
          className={cn(
            'min-h-0 flex-1',
            section === 'conversations' ? 'flex flex-col' : 'overflow-auto',
          )}
        >
          {section === 'conversations' &&
            (thread ? (
              <Chat
                key={`${thread.id}:${epoch}`}
                interviewsEnabled={state.modelConnection !== 'disabled'}
                thread={thread}
                roles={state.roles}
                topics={state.topics}
                initialMessage={initialMessage}
                clearInitial={() => setInitialMessage('')}
                refresh={refresh}
                act={act}
              />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center p-6 py-16 md:p-12">
                <div className="mb-6 flex size-12 items-center justify-center rounded-xl border">
                  <MessagesSquare className="size-5" />
                </div>
                <h2 className="text-3xl font-semibold tracking-tight">
                  Start with what you remember.
                </h2>
                <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
                  A space to work through your career with Eve. Explore one role, a project, or a
                  moment that’s stayed with you. The useful details will emerge as you talk.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button onClick={() => setNewThread(true)}>
                    <Plus />
                    Start a conversation
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTitle('');
                      setNewRole(true);
                    }}
                  >
                    Add a role
                  </Button>
                </div>
                {state.threads.length > 0 && (
                  <div className="mt-10">
                    <h3 className="mb-3 text-sm font-medium">Pick up where you left off</h3>
                    {state.threads.slice(0, 5).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="flex w-full items-center justify-between border-t py-4 text-left text-sm hover:text-muted-foreground"
                        onClick={() => setThreadId(t.id)}
                      >
                        {t.title}
                        <ArrowUpRight className="size-4" />
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-12 text-xs leading-5 text-muted-foreground">
                  Eve uses your local Codex sign-in. Run <code>bun run eve:login</code> once if you
                  haven’t connected it yet.
                </p>
              </div>
            ))}
          {section === 'knowledge' && <Knowledge state={state} act={act} />}
          {section === 'map' && (
            <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-8">
              <Intro
                title="Follow the threads."
                description="Keep track of what you’ve explored and what deserves another conversation. These are prompts for recall, not a scorecard."
              />
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Your roles</h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTitle('');
                    setCompany('');
                    setDates('');
                    setContext('');
                    setNewRole(true);
                  }}
                >
                  <Plus />
                  Add role
                </Button>
              </div>
              {state.roles.length === 0 && (
                <Empty text="Add your first role, or let Eve create it during a conversation." />
              )}
              {state.roles.map((role) => (
                <RoleCard key={role.id} role={role} act={act} />
              ))}
              <TopicMap state={state} act={act} />
            </div>
          )}
          {section === 'research' && (
            <Research
              state={state}
              act={act}
              track={async (listingId) => {
                const { job } = await act('jobs.track', { listingId });
                setTrackedJobId(job.id);
                setSection('jobs');
              }}
              process={() =>
                createThread(
                  'Process the pending research corpus with the extractor. Collect the full requirement map with verbatim source excerpts. Continue in batches and tell me which listings need the browser importer.',
                )
              }
            />
          )}
          {section === 'jobs' && <JobTracker initialId={trackedJobId} />}
          {section === 'settings' && <Preferences state={state} act={act} />}
        </div>
      </main>
      <Dialog
        title="New conversation"
        description="Choose a focus. You can return to this conversation whenever you like."
        open={newThread}
        onOpenChange={setNewThread}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createThread());
          }}
        >
          <Field label="Conversation title">
            <Input
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My first role, a challenging launch…"
            />
          </Field>
          <Field label="Related role">
            <Select className="w-full" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Open exploration</option>
              {state.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.company}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Start conversation</Button>
        </form>
      </Dialog>
      <Dialog
        title="Add a role"
        description="Just enough to orient the conversation. You and Eve can fill in the rest."
        open={newRole}
        onOpenChange={setNewRole}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await act('roles.save', { title, company, dates, context });
              setNewRole(false);
            });
          }}
        >
          <Field label="Role title">
            <Input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Company">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field label="When">
            <Input
              value={dates}
              onChange={(e) => setDates(e.target.value)}
              placeholder="Approximate dates are fine"
            />
          </Field>
          <Field label="Context">
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Team, product, company URL…"
            />
          </Field>
          <Button type="submit">Add role</Button>
        </form>
      </Dialog>
    </div>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
    </label>
  );
}
function Intro({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-sm leading-6 text-muted-foreground">
      {text}
    </div>
  );
}
type Act = (action: string, input?: unknown) => Promise<any>;
function RoleCard({ role, act }: { role: Role; act: Act }) {
  const [edit, setEdit] = useState(false);
  const [data, setData] = useState(role);
  return (
    <div className="border-b pb-5">
      {edit ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act('roles.save', data)
              .then(() => setEdit(false))
              .catch(() => {});
          }}
        >
          <Input
            aria-label="Role title"
            value={data.title}
            onChange={(e) => setData({ ...data, title: e.target.value })}
          />
          <Input
            aria-label="Company"
            value={data.company}
            onChange={(e) => setData({ ...data, company: e.target.value })}
          />
          <Input
            aria-label="Dates"
            value={data.dates}
            onChange={(e) => setData({ ...data, dates: e.target.value })}
          />
          <Textarea
            aria-label="Role context"
            value={data.context}
            onChange={(e) => setData({ ...data, context: e.target.value })}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save role
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">
              {role.title}{' '}
              {role.company && (
                <span className="font-normal text-muted-foreground">· {role.company}</span>
              )}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{role.dates}</p>
            {role.context && <p className="mt-2 whitespace-pre-wrap text-sm">{role.context}</p>}
          </div>
          <div className="flex gap-1">
            {' '}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setData(role);
                setEdit(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete role ${role.title} and related knowledge`}
              title="Permanently delete this role, its conversations and knowledge"
              onClick={() => void act('roles.delete', { id: role.id }).catch(() => {})}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function Knowledge({ state, act }: { state: Workspace; act: Act }) {
  const [selected, setSelected] = useState<EntryInput>();
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const open = (entry?: Entry) => {
    setHistory([]);
    setSelected(
      entry
        ? {
            id: entry.id,
            title: entry.title,
            roleId: entry.role_id,
            markdown: entry.markdown,
            skills: entry.skills,
            sourceMessageIds: entry.source_message_ids ?? [],
            expectedRevision: entry.revision,
          }
        : { title: '', markdown: '', skills: [], sourceMessageIds: [] },
    );
  };
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Intro
          title="A career, in your own words."
          description="Stories, decisions, skills, and context to draw from later. Useful experience doesn’t need a number attached."
        />
        <Button variant="outline" size="sm" onClick={() => open()}>
          <Plus />
          Add entry
        </Button>
      </div>
      {state.proposals.length > 0 && (
        <section className="space-y-4">
          <h3 className="font-medium">Changes to review</h3>
          {state.proposals.map((p) => {
            const before =
              p.action === 'entries.save'
                ? state.entries.find((e) => e.id === p.entry_id)
                : p.action === 'roles.save'
                  ? state.roles.find((r) => r.id === p.payload.id)
                  : state.topics.find((t) => t.id === p.payload.id);
            const beforeText = before ? proposalText(p.action, before, state.roles) : '';
            const afterText = proposalText(p.action, p.payload, state.roles);
            return (
              <div key={p.id} className="rounded-lg border p-4">
                <h4 className="font-medium">{p.payload.title ?? p.payload.label}</h4>
                <div className="my-4 overflow-auto whitespace-pre-wrap text-sm leading-6">
                  {diffLines(beforeText, afterText).map((part, i) => (
                    <div
                      key={`${i}:${part.count}`}
                      className={
                        part.added
                          ? 'bg-green-500/10'
                          : part.removed
                            ? 'bg-red-500/10 line-through'
                            : 'text-muted-foreground'
                      }
                    >
                      {part.added ? '+ ' : part.removed ? '− ' : ''}
                      {part.value}
                    </div>
                  ))}
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  {p.action === 'entries.save'
                    ? `Skills: ${p.payload.skills?.join(', ') || 'None'}`
                    : p.action === 'roles.save'
                      ? 'Role details'
                      : 'Interview topic'}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void act('proposals.accept', { id: p.id }).catch(() => {})}
                  >
                    Accept change
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void act('proposals.reject', { id: p.id }).catch(() => {})}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}
      <Input
        aria-label="Search knowledge"
        placeholder="Search stories and skills…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {state.entries.length === 0 && (
        <Empty text="Your bank starts empty. Talk with Eve or add an entry yourself; the details you choose to keep will appear here." />
      )}
      <div>
        {state.entries
          .filter((e) =>
            `${e.title} ${e.markdown} ${e.skills.join(' ')}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="block w-full border-b py-5 text-left hover:bg-muted/50"
              onClick={() => open(entry)}
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-medium">{entry.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {state.roles.find((r) => r.id === entry.role_id)?.company}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {entry.markdown.replace(/[#*_`]/g, '')}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {entry.skills.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </button>
          ))}
      </div>
      <Dialog
        title={selected?.id ? 'Edit career entry' : 'New career entry'}
        description="Save the story in whatever detail makes it useful to you."
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        {selected && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              void act('entries.save', selected)
                .then(() => setSelected(undefined))
                .catch(() => {})
                .finally(() => setSaving(false));
            }}
          >
            <Field label="Title">
              <Input
                required
                value={selected.title}
                onChange={(e) => setSelected({ ...selected, title: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <Select
                value={selected.roleId ?? ''}
                className="w-full"
                onChange={(e) => setSelected({ ...selected, roleId: e.target.value || null })}
              >
                <option value="">Across roles / personal</option>
                {state.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · {r.company}
                  </option>
                ))}
              </Select>
            </Field>
            <MarkdownEditor
              value={selected.markdown}
              onChange={(markdown) => setSelected({ ...selected, markdown })}
              placeholder="The story, your contribution, and what happened…"
            />
            <Field label="Skills (comma separated)">
              <Input
                value={selected.skills.join(', ')}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    skills: e.target.value.split(',').map((s) => s.trim()),
                  })
                }
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save entry'}
              </Button>
              {selected.id && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void api('entries.history', { id: selected.id }).then(setHistory)
                    }
                  >
                    History
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto text-destructive"
                    onClick={() =>
                      void act('entries.delete', { id: selected.id })
                        .then(() => setSelected(undefined))
                        .catch(() => {})
                    }
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </>
              )}
            </div>
            {selected.id && (
              <p className="text-xs leading-5 text-muted-foreground">
                Delete permanently removes this entry, its revisions, and linked conversation
                messages.
              </p>
            )}
            {history.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">Previous revisions</p>
                {history.map((rev) => (
                  <details key={rev.revision} className="text-sm">
                    <summary className="cursor-pointer py-2">
                      Revision {rev.revision} · {rev.title}
                    </summary>
                    <p className="whitespace-pre-wrap text-muted-foreground">{rev.markdown}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() =>
                        setSelected({
                          ...selected,
                          title: rev.title,
                          markdown: rev.markdown,
                          skills: rev.skills,
                        })
                      }
                    >
                      Restore into editor
                    </Button>
                  </details>
                ))}
              </div>
            )}
          </form>
        )}
      </Dialog>
    </div>
  );
}
function TopicMap({ state, act }: { state: Workspace; act: Act }) {
  const [roleId, setRoleId] = useState('');
  const [label, setLabel] = useState('');
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Areas to explore</h3>
        <Select
          aria-label="Filter topics by role"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        >
          <option value="">All roles</option>
          {state.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} · {r.company}
            </option>
          ))}
        </Select>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act('topics.save', { label, roleId: roleId || null, status: 'unexplored' })
            .then(() => setLabel(''))
            .catch(() => {});
        }}
      >
        <Input
          aria-label="New interview topic"
          placeholder="An area worth exploring…"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" variant="outline">
          Add topic
        </Button>
      </form>
      {state.topics
        .filter((t) => !roleId || t.role_id === roleId)
        .map((t) => (
          <div key={t.id} className="flex flex-wrap items-start gap-3 border-b py-4">
            <div className="min-w-48 flex-1">
              <p className="text-sm font-medium">{t.label}</p>
              <Textarea
                aria-label={`Notes for ${t.label}`}
                className="mt-2 min-h-16 border-transparent bg-muted/50"
                defaultValue={t.notes}
                onBlur={(e) => {
                  if (e.target.value !== t.notes)
                    void act('topics.save', {
                      ...t,
                      roleId: t.role_id,
                      notes: e.target.value,
                    }).catch(() => {});
                }}
              />
            </div>
            <Select
              aria-label={`Progress for ${t.label}`}
              value={t.status}
              onChange={(e) =>
                void act('topics.save', { ...t, roleId: t.role_id, status: e.target.value }).catch(
                  () => {},
                )
              }
            >
              {['unexplored', 'exploring', 'sufficient', 'revisit'].map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete topic ${t.label}`}
              onClick={() => void act('topics.delete', { id: t.id }).catch(() => {})}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      {state.topics.length === 0 && (
        <Empty text="Eve will build this map with you as you explore your roles. You can add your own prompts at any time." />
      )}
    </section>
  );
}
function Research({
  state,
  act,
  process,
  track,
}: {
  state: Workspace;
  act: Act;
  process: () => Promise<void>;
  track: (listingId: string) => Promise<void>;
}) {
  const [urls, setUrls] = useState('');
  const [family, setFamily] = useState(families[0]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const requirements = state.requirements;
  const [details, setDetails] = useState<Record<string, Listing>>({});
  const ready = state.listings.filter((l) => l.status === 'ready' && !l.duplicate_of).length;
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-8">
      <Intro
        title="What the market asks for."
        description="Build a broad requirement map to guide deeper conversations. NYC metro, Fairfield County, and eligible remote roles. This is research; choosing targets comes later."
      />
      <form
        className="space-y-3 rounded-lg border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void act('research.queue', { urls: urls.split(/\s+/).filter(Boolean), family })
            .then((rows) => {
              setResult(
                `${rows.filter((r: any) => r.status === 'queued').length} added · ${rows.filter((r: any) => r.status === 'existing').length} already imported · ${rows.filter((r: any) => r.status === 'invalid').length} invalid`,
              );
              setUrls('');
            })
            .catch(() => {})
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Listing URLs">
          <Textarea
            placeholder="Paste one URL per line…"
            required
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Input
            list="job-families"
            aria-label="Role family"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className="max-w-xs"
          />
          <datalist id="job-families">
            {families.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add to research'}
          </Button>
        </div>
        {result && (
          <p role="status" className="text-sm text-muted-foreground">
            {result}
          </p>
        )}
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {state.listings.length} sources · {ready} parsed · {requirements.length} requirements
        </p>
        <Button
          variant="outline"
          disabled={
            state.modelConnection === 'disabled' ||
            !state.listings.some(
              (l) => ['queued', 'extracting'].includes(l.status) && !l.duplicate_of,
            )
          }
          onClick={() => void process().catch(() => {})}
        >
          Process with Eve <ArrowUpRight />
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        For signed-in TrueUp pages, use <code>bun run import:browser</code> on this computer. The
        importer opens a dedicated browser profile and sends visible descriptions to Studio.
      </p>
      {requirements.length > 0 && (
        <details open className="rounded-lg border p-5">
          <summary className="cursor-pointer text-sm font-medium">
            Requirement map · {ready} unique listings
          </summary>
          <div className="mt-4 max-h-80 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 font-normal">Requirement</th>
                  <th className="font-normal">Listings</th>
                  <th className="font-normal">Role families</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.label} className="border-b">
                    <td className="py-3 pr-4">
                      {r.label}
                      <span className="block text-xs text-muted-foreground">{r.kind}</span>
                    </td>
                    <td>{r.count}</td>
                    <td className="text-xs text-muted-foreground">{r.families.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <Input
        aria-label="Filter listings"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a listing, company, or status…"
      />
      {state.listings.length === 0 && (
        <Empty text="Paste your first set of URLs. Eve will pull out the requirements and use recurring themes in the second interview pass." />
      )}
      {state.listings
        .filter((l) =>
          `${l.title} ${l.company} ${l.status} ${l.url}`
            .toLowerCase()
            .includes(filter.toLowerCase()),
        )
        .map((summary) => {
          const l = details[summary.id]
            ? { ...details[summary.id], status: summary.status, error: summary.error }
            : summary;
          return (
            <details
              onToggle={(event) => {
                if (event.currentTarget.open)
                  void api<Listing>('research.get', { id: l.id })
                    .then((item) => setDetails((current) => ({ ...current, [item.id]: item })))
                    .catch(() => {});
              }}
              key={l.id}
              className="border-b pb-4"
            >
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{l.title || new URL(l.url).hostname}</span>{' '}
                {l.company && <span className="text-muted-foreground">· {l.company}</span>}{' '}
                <Badge className="ml-2">
                  {l.duplicate_of ? 'Duplicate' : l.status.replaceAll('_', ' ')}
                </Badge>
              </summary>
              <div className="mt-4 space-y-3 text-sm">
                <a className="break-all underline" href={l.url} target="_blank" rel="noreferrer">
                  Open source ↗
                </a>
                <p className="text-muted-foreground">
                  {[l.family, l.seniority, l.location, l.arrangement].filter(Boolean).join(' · ')}
                </p>
                {l.error && <p className="text-destructive">{l.error}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void track(l.id).catch(() => {})}
                  >
                    Track job
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act('research.fetch', { id: l.id, refresh: true }).catch(() => {})
                    }
                  >
                    Fetch description
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void act('research.retry', { id: l.id }).catch(() => {})}
                  >
                    Queue extraction
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void act('research.delete', { id: l.id }).catch(() => {})}
                  >
                    Delete
                  </Button>
                </div>
                {l.requirements.map((r, i) => (
                  <div className="border-l pl-3" key={`${r.label}:${i}`}>
                    <p className="font-medium">
                      {r.label}{' '}
                      <span className="font-normal text-muted-foreground">· {r.section}</span>
                    </p>
                    <blockquote className="text-muted-foreground">“{r.quote}”</blockquote>
                  </div>
                ))}
                {l.description && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">
                      Original description
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-xs leading-6">
                      {l.description}
                    </pre>
                  </details>
                )}
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Paste a description manually
                  </summary>
                  <form
                    className="mt-3 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const data = new FormData(form);
                      void act('research.capture', {
                        id: l.id,
                        title: l.title,
                        company: l.company,
                        description: data.get('description'),
                        method: 'manual-v1',
                      })
                        .then(() => form.reset())
                        .catch(() => {});
                    }}
                  >
                    <Textarea
                      name="description"
                      aria-label="Original job description"
                      required
                      minLength={100}
                    />
                    <Button size="sm" type="submit">
                      Save source
                    </Button>
                  </form>
                </details>
              </div>
            </details>
          );
        })}
    </div>
  );
}
function Preferences({ state, act }: { state: Workspace; act: Act }) {
  const [prefs, setPrefs] = useState(state.settings);
  const [saved, setSaved] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6 md:p-8">
      <Intro
        title="How you and Eve work."
        description="Keep the conversation moving, and adjust the level of oversight when you need it."
      />
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          void act('settings.save', prefs)
            .then(() => setSaved(true))
            .catch(() => {});
        }}
      >
        <div className="flex items-start justify-between gap-6 border-b pb-6">
          <div>
            <label htmlFor="review-toggle" className="text-sm font-medium">
              Review Eve’s edits
            </label>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              When enabled, career entries, roles, and interview topics wait for your review in the
              knowledge bank. Deletions you request take effect directly.
            </p>
          </div>
          <Switch
            id="review-toggle"
            checked={prefs.reviewRequired}
            onCheckedChange={(reviewRequired) => {
              setPrefs({ ...prefs, reviewRequired });
              setSaved(false);
            }}
          />
        </div>
        <Field label="Interview model">
          <Input
            value={prefs.interviewModel}
            onChange={(e) => {
              setPrefs({ ...prefs, interviewModel: e.target.value });
              setSaved(false);
            }}
          />
        </Field>
        <Field label="Extraction model">
          <Input
            value={prefs.extractionModel}
            onChange={(e) => {
              setPrefs({ ...prefs, extractionModel: e.target.value });
              setSaved(false);
            }}
          />
        </Field>
        <p className="text-sm leading-6 text-muted-foreground">
          Model availability follows your local Codex subscription. Changes apply at the next agent
          step. Sign in using <code>bun run eve:login</code>. Remote model access and voice are
          planned for a later stage.
        </p>
        <Button type="submit">Save settings</Button>
        {saved && (
          <span role="status" className="ml-3 text-sm text-muted-foreground">
            Saved
          </span>
        )}
      </form>
      <div className="border-t pt-6 text-sm leading-7 text-muted-foreground">
        <p>
          Storage:{' '}
          {state.storage === 'local'
            ? 'local PostgreSQL, persisted on this computer'
            : 'PostgreSQL via DATABASE_URL'}
        </p>
        <p>
          Model connection:{' '}
          {state.modelConnection === 'disabled'
            ? 'interviews available in local Studio'
            : state.modelConnection === 'subscription'
              ? 'local Codex sign-in'
              : 'AI Gateway'}
        </p>
        <p>Your knowledge is private. Public publishing is a separate, later step.</p>
      </div>
    </div>
  );
}

function proposalText(action: string, data: any, roles: Role[]): string {
  const role = roles.find((r) => r.id === (data.roleId ?? data.role_id));
  if (action === 'entries.save')
    return `Title: ${data.title}\nRole: ${role?.title ?? 'Across roles'}\nSkills: ${(data.skills ?? []).join(', ')}\n\n${data.markdown ?? ''}`;
  if (action === 'roles.save')
    return `Role: ${data.title}\nCompany: ${data.company ?? ''}\nWhen: ${data.dates ?? ''}\n\n${data.context ?? ''}`;
  return `Topic: ${data.label}\nRole: ${role?.title ?? 'Across roles'}\nProgress: ${data.status}\n\n${data.notes ?? ''}`;
}
