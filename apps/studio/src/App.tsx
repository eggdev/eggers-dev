import type { CmsDraft } from '@repo/cms'
import { type PublicSiteContent, validatePublicSiteContent } from '@repo/content'
import { Alert } from '@repo/ui/alert'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { Separator } from '@repo/ui/separator'
import { Textarea } from '@repo/ui/textarea'
import { ApiError, api } from '@studio/api'
import { ResumeEditor } from '@studio/ResumeEditor'
import { ResumePreview } from '@studio/ResumePreview'
import { useCallback, useEffect, useState } from 'react'

type Section = 'site' | 'work' | 'process' | 'resume' | 'advanced'

const errorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.details.length > 0) {
    return `${error.message}: ${error.details.join('; ')}`
  }
  return error instanceof Error ? error.message : 'Something went wrong'
}

export function App() {
  const [draft, setDraft] = useState<CmsDraft>()
  const [content, setContent] = useState<PublicSiteContent>()
  const [section, setSection] = useState<Section>('site')
  const [identity, setIdentity] = useState('')
  const [publishedAt, setPublishedAt] = useState<string>()
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState('')
  const [advanced, setAdvanced] = useState('')
  const [resumePreviewExpanded, setResumePreviewExpanded] = useState(false)

  useEffect(() => {
    api
      .bootstrap()
      .then((payload) => {
        setDraft(payload.draft)
        setContent(payload.draft.content)
        setAdvanced(JSON.stringify(payload.draft.content, null, 2))
        setIdentity(payload.identity.email)
        setPublishedAt(payload.published?.publishedAt)
        setStatus('Saved')
      })
      .catch((cause) => {
        setError(errorMessage(cause))
        setStatus('Unavailable')
      })
  }, [])

  const dirty = Boolean(draft && content && content !== draft.content)

  const save = useCallback(async (): Promise<CmsDraft | undefined> => {
    if (!draft || !content || content === draft.content) return draft
    setStatus('Saving…')
    setError('')
    try {
      const saved = await api.saveDraft(content, draft.revision)
      setDraft(saved)
      setContent(saved.content)
      setStatus('Saved')
      return saved
    } catch (cause) {
      setStatus('Save failed')
      setError(errorMessage(cause))
      return undefined
    }
  }, [content, draft])

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => void save(), 900)
    return () => window.clearTimeout(timer)
  }, [dirty, save])

  const mutate = (update: (current: PublicSiteContent) => PublicSiteContent) => {
    setStatus('Unsaved changes')
    setContent((current) => (current ? update(current) : current))
  }

  const publish = async () => {
    const saved = await save()
    if (!saved) return
    setStatus('Publishing…')
    try {
      const result = await api.publish()
      setPublishedAt(result.publishedAt)
      setStatus('Published')
    } catch (cause) {
      setStatus('Publish failed')
      setError(errorMessage(cause))
    }
  }

  const preview = async () => {
    const saved = await save()
    if (!saved) return
    try {
      const result = await api.preview()
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const exportResume = async (resume: PublicSiteContent['resume']) => {
    try {
      const { downloadResumePdf } = await import('@repo/content/resume-pdf')
      await downloadResumePdf(resume)
    } catch (cause) {
      setError(`Could not export résumé: ${errorMessage(cause)}`)
    }
  }

  if (!content || !draft) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-3xl place-items-center p-6">
        <Alert className={error ? 'border-destructive text-destructive' : ''}>
          {error || status}
        </Alert>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto">
            <h1 className="text-lg font-bold tracking-tight">Studio</h1>
            <p className="text-xs text-muted-foreground">Editing eggers.dev as {identity}</p>
          </div>
          <Badge variant={dirty ? 'outline' : 'secondary'}>{status}</Badge>
          <Button variant="outline" onClick={() => void preview()}>
            Preview
          </Button>
          <Button onClick={() => void publish()}>Publish site</Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[13rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Editor sections">
          {(['site', 'work', 'process', 'resume', 'advanced'] as const).map((item) => (
            <Button
              key={item}
              variant={section === item ? 'secondary' : 'ghost'}
              className="justify-start capitalize"
              onClick={() => {
                if (item === 'advanced') setAdvanced(JSON.stringify(content, null, 2))
                setSection(item)
              }}
            >
              {item}
            </Button>
          ))}
          <Separator className="my-3 hidden lg:block" />
          <p className="hidden text-xs text-muted-foreground lg:block">
            Draft r{draft.revision}
            <br />
            {publishedAt ? `Published ${new Date(publishedAt).toLocaleString()}` : 'Not published'}
          </p>
        </nav>

        <main className="min-w-0">
          {error && <Alert className="mb-5 border-destructive text-destructive">{error}</Alert>}

          {section === 'site' && (
            <div className="grid gap-5">
              <EditorCard
                title="Search and sharing"
                description="Page title, description, and share-card text."
              >
                <Label>
                  Title
                  <Input
                    value={content.seo.title}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        seo: { ...current.seo, title: event.target.value },
                      }))
                    }
                  />
                </Label>
                <Label>
                  Description
                  <Textarea
                    value={content.seo.description}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        seo: { ...current.seo, description: event.target.value },
                      }))
                    }
                  />
                </Label>
                <Label>
                  Share image alt text
                  <Input
                    value={content.seo.ogAlt}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        seo: { ...current.seo, ogAlt: event.target.value },
                      }))
                    }
                  />
                </Label>
              </EditorCard>
              <EditorCard
                title="Identity"
                description="The public name, contact, and short professional profile."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['name', 'siteLabel', 'email', 'role', 'location'] as const).map((key) => (
                    <Label key={key} className="capitalize">
                      {key.replace(/([A-Z])/g, ' $1')}
                      <Input
                        value={content.identity[key]}
                        onChange={(event) =>
                          mutate((current) => ({
                            ...current,
                            identity: { ...current.identity, [key]: event.target.value },
                          }))
                        }
                      />
                    </Label>
                  ))}
                </div>
                <Label>
                  Summary
                  <Textarea
                    value={content.identity.summary}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        identity: { ...current.identity, summary: event.target.value },
                      }))
                    }
                  />
                </Label>
              </EditorCard>
              <EditorCard
                title="About and contact"
                description="Long-form introduction and the contact invitation."
              >
                <Label>
                  About heading
                  <Input
                    value={content.about.heading}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        about: { ...current.about, heading: event.target.value },
                      }))
                    }
                  />
                </Label>
                {content.about.paragraphs.map((paragraph, index) => (
                  <Label key={`${index}-${paragraph.slice(0, 12)}`}>
                    Paragraph {index + 1}
                    <Textarea
                      value={paragraph}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          about: {
                            ...current.about,
                            paragraphs: current.about.paragraphs.map((value, itemIndex) =>
                              itemIndex === index ? event.target.value : value
                            ),
                          },
                        }))
                      }
                    />
                  </Label>
                ))}
                <Label>
                  Contact introduction
                  <Textarea
                    value={content.contact.introduction}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        contact: { ...current.contact, introduction: event.target.value },
                      }))
                    }
                  />
                </Label>
              </EditorCard>
            </div>
          )}

          {section === 'work' && (
            <div className="grid gap-5">
              {content.work.stories.map((story, index) => (
                <EditorCard
                  key={story.id}
                  title={story.title || `Story ${index + 1}`}
                  description={`Work story ${index + 1}`}
                >
                  <div className="grid gap-4 sm:grid-cols-3">
                    {(['title', 'role', 'period'] as const).map((key) => (
                      <Label key={key} className="capitalize">
                        {key}
                        <Input
                          value={story[key]}
                          onChange={(event) =>
                            mutate((current) => ({
                              ...current,
                              work: {
                                stories: current.work.stories.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, [key]: event.target.value }
                                    : item
                                ),
                              },
                            }))
                          }
                        />
                      </Label>
                    ))}
                  </div>
                  <Label>
                    Opening
                    <Textarea
                      className="min-h-36"
                      value={story.opening}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          work: {
                            stories: current.work.stories.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, opening: event.target.value } : item
                            ),
                          },
                        }))
                      }
                    />
                  </Label>
                  <Label>
                    Outcome detail
                    <Textarea
                      value={story.detail}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          work: {
                            stories: current.work.stories.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, detail: event.target.value } : item
                            ),
                          },
                        }))
                      }
                    />
                  </Label>
                </EditorCard>
              ))}
            </div>
          )}

          {section === 'process' && (
            <EditorCard
              title="How I work"
              description="The editorial explanation and public harness excerpt."
            >
              <Label>
                Heading
                <Input
                  value={content.process.heading}
                  onChange={(event) =>
                    mutate((current) => ({
                      ...current,
                      process: { ...current.process, heading: event.target.value },
                    }))
                  }
                />
              </Label>
              <Label>
                Introduction
                <Textarea
                  className="min-h-32"
                  value={content.process.introduction}
                  onChange={(event) =>
                    mutate((current) => ({
                      ...current,
                      process: { ...current.process, introduction: event.target.value },
                    }))
                  }
                />
              </Label>
              {content.process.points.map((point, index) => (
                <div className="grid gap-3 rounded-md border p-4" key={`${index}-${point.heading}`}>
                  <Label>
                    Point {index + 1}
                    <Input
                      value={point.heading}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          process: {
                            ...current.process,
                            points: current.process.points.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, heading: event.target.value } : item
                            ),
                          },
                        }))
                      }
                    />
                  </Label>
                  <Label>
                    Explanation
                    <Textarea
                      value={point.body}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          process: {
                            ...current.process,
                            points: current.process.points.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, body: event.target.value } : item
                            ),
                          },
                        }))
                      }
                    />
                  </Label>
                </div>
              ))}
              <Label>
                Harness excerpt
                <Textarea
                  className="min-h-72 font-mono text-xs"
                  value={content.process.harnessCode}
                  onChange={(event) =>
                    mutate((current) => ({
                      ...current,
                      process: { ...current.process, harnessCode: event.target.value },
                    }))
                  }
                />
              </Label>
            </EditorCard>
          )}

          {section === 'resume' && (
            <div className="grid gap-5 xl:grid-cols-[minmax(32rem,1.15fr)_minmax(24rem,0.85fr)] xl:items-start">
              <ResumeEditor
                resume={content.resume}
                onChange={(resume) => mutate((current) => ({ ...current, resume }))}
              />
              <ResumePreview
                resume={content.resume}
                publicUrl="https://eggers.dev/resume"
                expanded={resumePreviewExpanded}
                onExpandedChange={setResumePreviewExpanded}
                onExport={() => exportResume(content.resume)}
              />
            </div>
          )}

          {section === 'advanced' && (
            <EditorCard
              title="Structured snapshot"
              description="Every publishable field. Changes are checked against the same Effect Schema used by the Workers."
            >
              <Textarea
                className="min-h-[65vh] font-mono text-xs"
                value={advanced}
                onChange={(event) => setAdvanced(event.target.value)}
                spellCheck={false}
              />
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    const candidate: unknown = JSON.parse(advanced)
                    const result = validatePublicSiteContent(candidate)
                    if (!result.data) throw new Error(result.errors.join('; '))
                    setContent(result.data)
                    setError('')
                  } catch (cause) {
                    setError(errorMessage(cause))
                  }
                }}
              >
                Apply validated JSON
              </Button>
            </EditorCard>
          )}
        </main>
      </div>
    </div>
  )
}

function EditorCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  )
}
