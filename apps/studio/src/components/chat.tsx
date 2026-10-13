'use client';
import type { Message, Role, Thread, Topic } from '@repo/domain/types';
import { Badge, Button, Select } from '@repo/ui';
import { MarkdownEditor } from '@repo/ui/editor';
import { api } from '@studio/components/api';
import { defaultMessageReducer, useEveAgent } from 'eve/react';
import { ArrowUp, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = {
  interviewsEnabled: boolean;
  thread: Thread;
  roles: Role[];
  topics: Topic[];
  initialMessage: string;
  clearInitial: () => void;
  refresh: () => Promise<void>;
  act: (action: string, input?: unknown) => Promise<any>;
};
export function Chat(props: Props) {
  const [loaded, setLoaded] = useState<{ thread: Thread; messages: Message[] }>();
  const [error, setError] = useState('');
  useEffect(() => {
    void api('threads.get', { id: props.thread.id })
      .then(setLoaded)
      .catch((e) => setError(e.message));
  }, [props.thread.id]);
  if (error)
    return (
      <p role="alert" className="p-8">
        {error}
      </p>
    );
  if (!loaded) return <p className="p-8 text-sm text-muted-foreground">Opening conversation…</p>;
  if (!props.interviewsEnabled)
    return (
      <section className="flex-1 overflow-auto p-6 md:p-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <h2 className="text-xl font-semibold">{loaded.thread.title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Interviews run in Studio on your computer for now. You can read the saved conversation
            here.
          </p>
          {loaded.messages.map((message) => (
            <MessageView key={message.id} role={message.kind} text={message.body} />
          ))}
          {!loaded.messages.length && <p className="text-sm">No messages yet.</p>}
        </div>
      </section>
    );
  return <ConnectedChat {...props} loaded={loaded} />;
}
function ConnectedChat({
  thread,
  roles,
  topics,
  initialMessage,
  clearInitial,
  refresh,
  act,
  loaded,
}: Props & { loaded: { thread: Thread; messages: Message[] } }) {
  const [draft, setDraft] = useState(initialMessage);
  const [localError, setLocalError] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const tail = useRef<HTMLDivElement>(null);
  const session = loaded.thread.session;
  const initialSession = session
    ? { sessionId: session.sessionId ?? session.id, streamIndex: session.streamIndex ?? 0 }
    : undefined;
  const initialEvents = loaded.thread.events ?? [];
  const eve = useEveAgent({
    reducer: defaultMessageReducer(),
    initialSession,
    initialEvents,
    resume: !!initialSession,
    headers: { 'x-studio-thread-id': thread.id },
    onSessionChange: (session) => {
      if (session)
        void api('threads.cursor', { id: thread.id, session, events: [] }).catch((e) =>
          setLocalError(e.message),
        );
    },
    onFinish: (snapshot) => {
      void api('threads.cursor', {
        id: thread.id,
        session: snapshot.session,
        events: snapshot.events,
      })
        .then(refresh)
        .catch((e) => setLocalError(e.message));
    },
    onError: (error) => setLocalError(error.message),
  });
  const busy = ['streaming', 'submitted', 'resuming'].includes(eve.status);
  const role = roles.find((r) => r.id === thread.role_id);
  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [eve.data.messages.length, eve.status]);
  // When no event snapshot exists, the canonical transcript covers earlier local sessions.
  const stored = initialEvents.length === 0 ? loaded.messages : [];
  const messages = eve.data.messages;
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setLocalError('');
    setDraft('');
    clearInitial();
    setResetKey((n) => n + 1);
    await eve.send(text);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="flex min-h-[70dvh] min-w-0 flex-1 flex-col md:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 md:px-8">
          <div>
            <h2 className="font-semibold">{thread.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {role ? `${role.title} · ${role.company}` : 'Open exploration'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Interview phase"
              value={thread.phase}
              onChange={(e) =>
                void act('threads.phase', { id: thread.id, phase: e.target.value }).catch(() => {})
              }
            >
              <option value="recall">Pass 1 · Recall</option>
              <option value="discovery">Pass 2 · Dig deeper</option>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete conversation and its linked entries"
              title="Permanently delete conversation and linked entries"
              onClick={() => void act('threads.delete', { id: thread.id }).catch(() => {})}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-8 md:px-8">
          <div className="mx-auto max-w-3xl space-y-8">
            {!stored.length && !messages.length && (
              <div className="py-12">
                <Badge>Ready when you are</Badge>
                <h3 className="mt-5 text-2xl font-semibold tracking-tight">
                  Where should we begin?
                </h3>
                <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
                  Tell Eve about{' '}
                  {role ? `your time at ${role.company || 'this role'}` : 'a role or project'}.
                  Start anywhere: what you were building, who you worked with, or a problem you
                  remember solving.
                </p>
              </div>
            )}
            {stored.map((m) => (
              <MessageView key={m.id} role={m.kind} text={m.body} />
            ))}
            {messages.map((m) => (
              <div key={m.id}>
                {m.parts
                  .filter((p) => p.type === 'text')
                  .map((p, i) => (
                    <MessageView
                      key={`${m.id}:${i}`}
                      role={m.role}
                      text={p.type === 'text' ? p.text : ''}
                    />
                  ))}
                {m.parts.some((p) => p.type === 'dynamic-tool') && (
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Workspace activity</summary>
                    <ul className="mt-2 space-y-2">
                      {m.parts
                        .filter((p) => p.type === 'dynamic-tool')
                        .map((p) => (
                          <li key={p.toolCallId}>
                            {p.toolName.replaceAll('_', ' ')} · {p.state}
                            {p.errorText && (
                              <span className="block text-destructive">{p.errorText}</span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {eve.status === 'resuming'
                  ? 'Reconnecting to your conversation…'
                  : 'Eve is working…'}
              </p>
            )}
            <div ref={tail} />
          </div>
        </div>
        <div className="shrink-0 border-t px-5 py-4 md:px-8">
          <div className="mx-auto max-w-3xl">
            {(localError || eve.error) && (
              <div
                role="alert"
                className="mb-3 rounded-md border border-destructive/30 p-3 text-sm"
              >
                <p>{localError || eve.error?.message}</p>
                <p className="mt-2 text-muted-foreground">
                  Check your local Codex sign-in with <code>bun run eve:login</code>. Your saved
                  conversation stays in Studio.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setLocalError('');
                    void eve.resume().catch((e) => setLocalError(e.message));
                  }}
                >
                  <RotateCcw />
                  Reconnect
                </Button>
              </div>
            )}
            <MarkdownEditor
              key={resetKey}
              value={draft}
              onChange={setDraft}
              placeholder="Talk with Eve…"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Markdown shortcuts · Type / for formatting
              </p>
              {busy ? (
                <Button variant="outline" size="sm" onClick={() => void eve.cancel()}>
                  <Square />
                  Stop
                </Button>
              ) : (
                <Button size="sm" disabled={!draft.trim()} onClick={() => void submit()}>
                  <ArrowUp />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
      <aside className="hidden w-64 shrink-0 overflow-auto border-l p-5 xl:block">
        <p className="text-xs font-medium text-muted-foreground">THIS CONVERSATION</p>
        <h3 className="mt-5 text-sm font-medium">
          {thread.phase === 'recall' ? 'Free recall' : 'Requirement-led exploration'}
        </h3>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {thread.phase === 'recall'
            ? 'Start with your memories. Eve will help surface context, decisions, and contributions before introducing outside prompts.'
            : 'Use recurring job requirements to revisit your experience. A missing story is an invitation to explore, not a failing.'}
        </p>
        <h3 className="mt-8 text-sm font-medium">Interview map</h3>
        <div className="mt-3 space-y-4">
          {topics
            .filter((t) => t.role_id === thread.role_id)
            .map((t) => (
              <div key={t.id}>
                <p className="text-sm">{t.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.status}</p>
              </div>
            ))}
          {!topics.some((t) => t.role_id === thread.role_id) && (
            <p className="text-xs leading-6 text-muted-foreground">
              Areas to explore will appear as you talk. You can also edit them in Interview map.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
function MessageView({ role, text }: { role: string; text: string }) {
  if (!text) return null;
  return (
    <article>
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {role === 'user' ? 'You' : 'Eve'}
      </p>
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </article>
  );
}
