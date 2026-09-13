import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CareerDocument, ResumeRecord } from '../shared'
import { ApiError, api } from './api'
import { ResumeEditor } from './ResumeEditor'
import { ResumePreview } from './ResumePreview'

const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((module) => ({ default: module.MarkdownEditor }))
)

type View = 'library' | 'resume'
type SaveStatus = 'Saved' | 'Waiting' | 'Saving' | 'Save failed'

export function App() {
  const [view, setView] = useState<View>('library')
  const [documents, setDocuments] = useState<CareerDocument[]>([])
  const [resumes, setResumes] = useState<ResumeRecord[]>([])
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>()
  const [selectedResumeId, setSelectedResumeId] = useState<string>()
  const [identity, setIdentity] = useState<{ email: string; local: boolean }>()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [documentSaveStatus, setDocumentSaveStatus] = useState<SaveStatus>('Saved')
  const [resumeSaveStatus, setResumeSaveStatus] = useState<SaveStatus>('Saved')
  const [publishing, setPublishing] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)

  const documentTimers = useRef(new Map<string, number>())
  const resumeTimers = useRef(new Map<string, number>())
  const latestDocuments = useRef(new Map<string, CareerDocument>())
  const latestResumes = useRef(new Map<string, ResumeRecord>())
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .bootstrap()
      .then((payload) => {
        setDocuments(payload.documents)
        setResumes(payload.resumes)
        setIdentity(payload.identity)
        setSelectedDocumentId(payload.documents[0]?.id)
        setSelectedResumeId(
          payload.resumes.find((resume) => resume.isCanonical)?.id ?? payload.resumes[0]?.id
        )
      })
      .catch((error: unknown) => {
        setFatalError(error instanceof Error ? error.message : 'Could not open Career Studio')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(
    () => () => {
      for (const timer of documentTimers.current.values()) window.clearTimeout(timer)
      for (const timer of resumeTimers.current.values()) window.clearTimeout(timer)
    },
    []
  )

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setView('library')
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
      }
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (latestDocuments.current.size === 0 && latestResumes.current.size === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  const replaceDocument = (next: CareerDocument) =>
    setDocuments((items) => items.map((item) => (item.id === next.id ? next : item)))
  const replaceResume = (next: ResumeRecord) =>
    setResumes((items) => items.map((item) => (item.id === next.id ? next : item)))

  const persistDocument = async (id: string) => {
    const document = latestDocuments.current.get(id)
    if (!document) return
    documentTimers.current.delete(id)
    setDocumentSaveStatus('Saving')
    try {
      const saved = await api.updateDocument(document)
      const latest = latestDocuments.current.get(id)
      if (latest === document) {
        latestDocuments.current.delete(id)
        replaceDocument(saved)
        setDocumentSaveStatus('Saved')
      } else if (latest) {
        latestDocuments.current.set(id, { ...latest, revision: saved.revision })
        window.clearTimeout(documentTimers.current.get(id))
        documentTimers.current.set(
          id,
          window.setTimeout(() => void persistDocument(id), 50)
        )
      }
    } catch (error) {
      setDocumentSaveStatus('Save failed')
      setNotice(error instanceof Error ? error.message : 'Document save failed')
    }
  }

  const queueDocumentSave = (document: CareerDocument) => {
    replaceDocument(document)
    latestDocuments.current.set(document.id, document)
    setDocumentSaveStatus('Waiting')
    window.clearTimeout(documentTimers.current.get(document.id))
    documentTimers.current.set(
      document.id,
      window.setTimeout(() => void persistDocument(document.id), 650)
    )
  }

  const persistResume = async (id: string) => {
    const resume = latestResumes.current.get(id)
    if (!resume) return
    resumeTimers.current.delete(id)
    setResumeSaveStatus('Saving')
    try {
      const saved = await api.updateResume(resume)
      const latest = latestResumes.current.get(id)
      if (latest === resume) {
        latestResumes.current.delete(id)
        replaceResume(saved)
        setResumeSaveStatus('Saved')
      } else if (latest) {
        latestResumes.current.set(id, { ...latest, revision: saved.revision })
        window.clearTimeout(resumeTimers.current.get(id))
        resumeTimers.current.set(
          id,
          window.setTimeout(() => void persistResume(id), 50)
        )
      }
    } catch (error) {
      setResumeSaveStatus('Save failed')
      setNotice(error instanceof Error ? error.message : 'Résumé save failed')
    }
  }

  const queueResumeSave = (resume: ResumeRecord) => {
    replaceResume(resume)
    latestResumes.current.set(resume.id, resume)
    setResumeSaveStatus('Waiting')
    window.clearTimeout(resumeTimers.current.get(resume.id))
    resumeTimers.current.set(
      resume.id,
      window.setTimeout(() => void persistResume(resume.id), 650)
    )
  }

  const saveResumeNow = async (resume: ResumeRecord): Promise<ResumeRecord> => {
    window.clearTimeout(resumeTimers.current.get(resume.id))
    resumeTimers.current.delete(resume.id)
    const candidate = latestResumes.current.get(resume.id) ?? resume
    latestResumes.current.delete(resume.id)
    setResumeSaveStatus('Saving')
    let saved: ResumeRecord
    try {
      saved = await api.updateResume(candidate)
    } catch (error) {
      latestResumes.current.set(resume.id, candidate)
      setResumeSaveStatus('Save failed')
      throw error
    }
    const newer = latestResumes.current.get(resume.id)
    if (newer) {
      return saveResumeNow({ ...newer, revision: saved.revision })
    }
    replaceResume(saved)
    setResumeSaveStatus('Saved')
    return saved
  }

  const activeDocument = documents.find((document) => document.id === selectedDocumentId)
  const activeResume = resumes.find((resume) => resume.id === selectedResumeId)
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return documents
    return documents.filter(
      (document) =>
        document.title.toLowerCase().includes(query) ||
        document.bodyMarkdown.toLowerCase().includes(query) ||
        document.tags.some((tag) => tag.toLowerCase().includes(query))
    )
  }, [documents, search])

  const createDocument = async () => {
    try {
      const document = await api.createDocument({
        title: 'Untitled note',
        kind: 'inbox',
        visibility: 'private',
        tags: ['inbox'],
        bodyMarkdown: '',
      })
      setDocuments((items) => [document, ...items])
      setSelectedDocumentId(document.id)
      setView('library')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create note')
    }
  }

  const archiveActiveDocument = async () => {
    if (!activeDocument || !window.confirm(`Archive “${activeDocument.title}”?`)) return
    const pending = latestDocuments.current.get(activeDocument.id)
    window.clearTimeout(documentTimers.current.get(activeDocument.id))
    documentTimers.current.delete(activeDocument.id)
    try {
      await api.archiveDocument(activeDocument.id)
      latestDocuments.current.delete(activeDocument.id)
      const remaining = documents.filter((document) => document.id !== activeDocument.id)
      setDocuments(remaining)
      setSelectedDocumentId(remaining[0]?.id)
    } catch (error) {
      if (pending) queueDocumentSave(pending)
      setNotice(error instanceof Error ? error.message : 'Could not archive note')
    }
  }

  const cloneActiveResume = async () => {
    if (!activeResume) return
    try {
      const saved = await saveResumeNow(activeResume)
      const clone = await api.cloneResume(saved.id)
      setResumes((items) => [...items, clone])
      setSelectedResumeId(clone.id)
      setNotice('Private résumé variant created')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not duplicate résumé')
    }
  }

  const publishActiveResume = async () => {
    if (!activeResume?.isCanonical) return
    setPublishing(true)
    try {
      const saved = await saveResumeNow(activeResume)
      const result = await api.publishResume(saved.id)
      replaceResume({
        ...saved,
        publishedAt: result.publishedAt,
        publishedCommit: result.commitSha,
      })
      setNotice('Published to main. Cloudflare is rebuilding eggers.dev/resume.')
    } catch (error) {
      const detail =
        error instanceof ApiError && error.details.length > 0 ? ` ${error.details[0]}` : ''
      setNotice(`${error instanceof Error ? error.message : 'Publish failed'}${detail}`)
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <main className="center-state">
        <span className="loading-mark" aria-hidden="true" />
        <p>Opening Career Studio…</p>
      </main>
    )
  }

  if (fatalError) {
    return (
      <main className="center-state center-state--error">
        <p className="eyebrow">Could not open Studio</p>
        <h1>{fatalError}</h1>
        <p>Run the D1 migration, then reload this page.</p>
      </main>
    )
  }

  return (
    <div className="studio-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span>Career Studio</span>
        </div>
        <nav className="view-switcher" aria-label="Workspace">
          <button
            type="button"
            aria-current={view === 'library'}
            onClick={() => {
              setView('library')
              setPreviewExpanded(false)
            }}
          >
            Library
          </button>
          <button type="button" aria-current={view === 'resume'} onClick={() => setView('resume')}>
            Résumés
          </button>
        </nav>
        <div className="identity">
          <span className="identity__dot" aria-hidden="true" />
          <span>{identity?.local ? 'Local workspace' : identity?.email}</span>
        </div>
      </header>

      <aside className="sidebar">
        {view === 'library' ? (
          <>
            <div className="sidebar__top">
              <label className="search-field">
                <span className="visually-hidden">Search notes</span>
                <input
                  ref={searchInputRef}
                  placeholder="Search everything…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <kbd>⌘K</kbd>
              </label>
              <button className="new-button" type="button" onClick={() => void createDocument()}>
                <span aria-hidden="true">+</span> New note
              </button>
            </div>
            <div className="sidebar__label">
              <span>Documents</span>
              <span>{filteredDocuments.length}</span>
            </div>
            <nav className="document-list" aria-label="Career documents">
              {filteredDocuments.map((document) => (
                <button
                  type="button"
                  className={document.id === selectedDocumentId ? 'is-active' : ''}
                  key={document.id}
                  onClick={() => setSelectedDocumentId(document.id)}
                >
                  <span className={`kind-dot kind-dot--${document.kind}`} aria-hidden="true" />
                  <span>
                    <strong>{document.title}</strong>
                    <small>{document.tags.slice(0, 3).join(' · ') || 'Untagged'}</small>
                  </span>
                </button>
              ))}
            </nav>
          </>
        ) : (
          <>
            <div className="sidebar__top">
              <p className="sidebar__intro">
                One public résumé. Private variants stay here until exported.
              </p>
            </div>
            <div className="sidebar__label">
              <span>Résumés</span>
              <span>{resumes.length}</span>
            </div>
            <nav className="document-list" aria-label="Résumé variants">
              {resumes.map((resume) => (
                <button
                  type="button"
                  className={resume.id === selectedResumeId ? 'is-active' : ''}
                  key={resume.id}
                  onClick={() => setSelectedResumeId(resume.id)}
                >
                  <span
                    className={`kind-dot ${resume.isCanonical ? 'kind-dot--public' : ''}`}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{resume.title}</strong>
                    <small>{resume.isCanonical ? 'Public canonical' : 'Private variant'}</small>
                  </span>
                </button>
              ))}
            </nav>
          </>
        )}
      </aside>

      {view === 'library' ? (
        <main className="workspace workspace--document">
          {activeDocument ? (
            <>
              <header className="document-header">
                <input
                  className="document-title"
                  aria-label="Document title"
                  value={activeDocument.title}
                  onChange={(event) =>
                    queueDocumentSave({ ...activeDocument, title: event.target.value })
                  }
                />
                <div className="document-meta">
                  <label>
                    <span>Kind</span>
                    <select
                      value={activeDocument.kind}
                      onChange={(event) =>
                        queueDocumentSave({
                          ...activeDocument,
                          kind: event.target.value as CareerDocument['kind'],
                        })
                      }
                    >
                      <option value="inbox">Inbox</option>
                      <option value="note">Note</option>
                    </select>
                  </label>
                  <label>
                    <span>Visibility</span>
                    <select
                      value={activeDocument.visibility}
                      onChange={(event) =>
                        queueDocumentSave({
                          ...activeDocument,
                          visibility: event.target.value as CareerDocument['visibility'],
                        })
                      }
                    >
                      <option value="private">Private</option>
                      <option value="shareable">Shareable</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <label className="tag-input">
                    <span>Tags</span>
                    <input
                      value={activeDocument.tags.join(', ')}
                      placeholder="product, leadership"
                      onChange={(event) =>
                        queueDocumentSave({
                          ...activeDocument,
                          tags: event.target.value.split(',').map((tag) => tag.trim()),
                        })
                      }
                    />
                  </label>
                  <span
                    className={`save-state save-state--${documentSaveStatus.toLowerCase().replace(' ', '-')}`}
                  >
                    {documentSaveStatus}
                  </span>
                  <button
                    className="text-button text-button--danger"
                    type="button"
                    onClick={() => void archiveActiveDocument()}
                  >
                    Archive
                  </button>
                </div>
              </header>
              <Suspense fallback={<div className="editor-loading">Opening editor…</div>}>
                <MarkdownEditor
                  key={activeDocument.id}
                  documentId={activeDocument.id}
                  value={activeDocument.bodyMarkdown}
                  onChange={(bodyMarkdown) =>
                    queueDocumentSave({ ...activeDocument, bodyMarkdown })
                  }
                />
              </Suspense>
            </>
          ) : (
            <div className="empty-state">
              <p className="eyebrow">Nothing selected</p>
              <h1>Capture the thing before you organize it.</h1>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void createDocument()}
              >
                New note
              </button>
            </div>
          )}
        </main>
      ) : activeResume ? (
        <main className="workspace workspace--resume">
          <section className="editor-pane">
            <ResumeEditor
              key={activeResume.id}
              resume={activeResume}
              saveStatus={resumeSaveStatus}
              publishing={publishing}
              onChange={queueResumeSave}
              onClone={() => void cloneActiveResume()}
              onPublish={() => void publishActiveResume()}
              onPrint={() => window.print()}
              onPreview={() => setPreviewExpanded(true)}
            />
          </section>
          <aside
            className={`preview-pane ${previewExpanded ? 'preview-pane--expanded' : ''}`}
            aria-label="Live résumé preview"
          >
            <ResumePreview
              resume={activeResume.data}
              publicUrl={activeResume.isCanonical ? 'https://eggers.dev/resume' : undefined}
              expanded={previewExpanded}
              onExpandedChange={setPreviewExpanded}
            />
          </aside>
        </main>
      ) : (
        <main className="workspace">
          <div className="empty-state">
            <h1>No résumé found.</h1>
          </div>
        </main>
      )}

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}
