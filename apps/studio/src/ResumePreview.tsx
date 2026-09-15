/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: the preview is an intentionally focusable scroll region */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */
import { makePublicResume, type ResumeContent } from '@repo/content'
import { Button } from '@repo/ui/button'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const PAGE_WIDTH = 816
const PAGE_HEIGHT = 1056
const MIN_SCALE = 0.35
const MAX_SCALE = 1.25
const SCALE_STEP = 0.1

interface Props {
  resume: ResumeContent
  publicUrl?: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onExport: () => Promise<void>
}

type Zoom = 'fit' | number

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

const densityClasses: Record<
  ResumeContent['density'],
  { page: string; section: string; entry: string }
> = {
  comfortable: {
    page: 'text-[10.1px] leading-[1.48]',
    section: 'mt-[14px]',
    entry: 'mb-[12px]',
  },
  compact: {
    page: 'text-[9.7px] leading-[1.42]',
    section: 'mt-[12px]',
    entry: 'mb-[10px]',
  },
  tight: {
    page: 'text-[9.25px] leading-[1.36]',
    section: 'mt-[10px]',
    entry: 'mb-[8px]',
  },
}

export function ResumePreview({ resume, publicUrl, expanded, onExpandedChange, onExport }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const [fitScale, setFitScale] = useState(0.7)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [overflowing, setOverflowing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const scale = zoom === 'fit' ? fitScale : zoom
  const visibleResume = useMemo(() => makePublicResume(resume), [resume])
  const density = densityClasses[visibleResume.density]
  const contactItems = [
    { id: 'location', label: visibleResume.profile.location },
    { id: 'email', label: visibleResume.profile.email },
    ...visibleResume.profile.links,
  ].filter((item) => item.label.length > 0)

  useLayoutEffect(() => {
    const scrollport = scrollRef.current
    if (!scrollport) return
    const measure = () => {
      const availableWidth = Math.max(0, scrollport.clientWidth - 32)
      const availableHeight = Math.max(0, scrollport.clientHeight - 32)
      setFitScale(
        clampScale(Math.min(1, availableWidth / PAGE_WIDTH, availableHeight / PAGE_HEIGHT))
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scrollport)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    void visibleResume
    const page = pageRef.current
    if (!page) return
    setOverflowing(page.scrollHeight > page.clientHeight + 1)
  }, [visibleResume])

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExpandedChange(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [expanded, onExpandedChange])

  const changeZoom = (direction: -1 | 1) => {
    const next = Math.round((scale + direction * SCALE_STEP) * 100) / 100
    setZoom(clampScale(next))
  }

  const exportPdf = async () => {
    setExporting(true)
    try {
      await onExport()
    } finally {
      setExporting(false)
    }
  }

  const scaledWidth = Math.ceil(PAGE_WIDTH * scale)
  const scaledHeight = Math.ceil(PAGE_HEIGHT * scale)

  return (
    <aside
      className={
        expanded
          ? 'fixed inset-0 z-50 flex min-h-0 flex-col bg-background'
          : 'sticky top-24 flex h-[calc(100dvh-7rem)] min-h-[38rem] flex-col overflow-hidden rounded-lg border bg-muted'
      }
      aria-label="Live résumé preview"
    >
      <header className="flex min-h-14 flex-none flex-wrap items-center justify-between gap-3 border-b bg-background px-3 py-2">
        <div>
          <p className="text-sm font-semibold">Live résumé</p>
          <p className="text-xs capitalize text-muted-foreground">
            Letter · {visibleResume.density}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <fieldset className="flex overflow-hidden rounded-md border">
            <legend className="sr-only">Preview zoom</legend>
            <Button
              type="button"
              variant={zoom === 'fit' ? 'secondary' : 'ghost'}
              size="sm"
              className="rounded-none border-r"
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
            >
              Fit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-none"
              aria-label="Zoom out"
              disabled={scale <= MIN_SCALE}
              onClick={() => changeZoom(-1)}
            >
              −
            </Button>
            <output
              className="grid min-w-12 place-items-center border-x px-1 text-xs tabular-nums text-muted-foreground"
              aria-label="Preview zoom"
            >
              {Math.round(scale * 100)}%
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-none"
              aria-label="Zoom in"
              disabled={scale >= MAX_SCALE}
              onClick={() => changeZoom(1)}
            >
              +
            </Button>
          </fieldset>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={() => void exportPdf()}
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </Button>
          {publicUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={publicUrl} target="_blank" rel="noreferrer">
                Public ↗
              </a>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={expanded}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? 'Close' : 'Expand'}
          </Button>
        </div>
      </header>

      <section
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable_both-edges]"
        ref={scrollRef}
        tabIndex={0}
        aria-label="Scrollable résumé page preview"
      >
        <div
          className="relative flex min-h-full min-w-full items-start justify-center p-4"
          style={{ width: `${scaledWidth + 32}px`, height: `${scaledHeight + 32}px` }}
        >
          {overflowing && (
            <p className="absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-md border border-destructive/40 bg-background px-2 py-1 text-xs font-semibold text-destructive">
              Content exceeds one page
            </p>
          )}
          <div
            className="relative flex-none"
            style={{ width: `${scaledWidth}px`, height: `${scaledHeight}px` }}
          >
            <article
              className={`absolute left-0 top-0 h-[1056px] w-[816px] origin-top-left overflow-hidden border border-[#d8dde5] bg-white px-[67px] pb-[46px] pt-[52px] font-sans text-[#29313d] ${density.page}`}
              id="resume-preview"
              ref={pageRef}
              style={{ transform: `scale(${scale})` }}
            >
              <header>
                {visibleResume.profile.name && (
                  <h1 className="m-0 text-[27px] font-[760] leading-none tracking-[-0.035em] text-[#151b24]">
                    {visibleResume.profile.name}
                  </h1>
                )}
                {visibleResume.profile.headline && (
                  <p className="m-0 mt-[3px] text-[11.5px] font-[650] text-[#245b9d]">
                    {visibleResume.profile.headline}
                  </p>
                )}
                {contactItems.length > 0 && (
                  <p className="m-0 mt-[7px] flex flex-wrap text-[9px] text-[#5c6675]">
                    {contactItems.map((item, index) => (
                      <span key={item.id}>
                        {index > 0 && (
                          <span className="mx-[0.55em] font-bold text-[#a6afbb]">·</span>
                        )}
                        {item.label}
                      </span>
                    ))}
                  </p>
                )}
                {visibleResume.profile.summary && (
                  <p className="m-0 mt-[12px] max-w-[67em] text-[calc(1em+0.25px)] leading-[1.48] text-[#333c49]">
                    {visibleResume.profile.summary}
                  </p>
                )}
              </header>

              {visibleResume.experience.length > 0 && (
                <section className={density.section}>
                  <ResumeSectionHeading>Experience</ResumeSectionHeading>
                  {visibleResume.experience.map((entry) => {
                    const brief = entry.bullets.length === 0
                    return (
                      <div
                        className={`break-inside-avoid ${brief ? 'mb-[4px]' : density.entry}`}
                        key={entry.id}
                      >
                        {(entry.role || entry.organization || entry.location || entry.period) && (
                          <div className="flex items-baseline justify-between gap-3">
                            {(entry.role || entry.organization || entry.location) && (
                              <h3
                                className={`m-0 leading-[1.25] text-[#151b24] ${
                                  brief
                                    ? 'text-[calc(1em+0.1px)] font-[570]'
                                    : 'text-[calc(1em+0.7px)] font-[680]'
                                }`}
                              >
                                {entry.role}
                                {entry.role && (entry.organization || entry.location) && (
                                  <span className="mx-[0.5em] font-bold text-[#c5ccd5]">·</span>
                                )}
                                {entry.organization && (
                                  <span className="font-[450] text-[#5c6675]">
                                    {entry.organization}
                                  </span>
                                )}
                                {entry.organization && entry.location && (
                                  <span className="mx-[0.5em] font-bold text-[#c5ccd5]">·</span>
                                )}
                                {entry.location && (
                                  <span className="font-[450] text-[#5c6675]">
                                    {entry.location}
                                  </span>
                                )}
                              </h3>
                            )}
                            {entry.period && <ResumeDate>{entry.period}</ResumeDate>}
                          </div>
                        )}
                        {entry.note && (
                          <p className="m-0 mt-px text-[calc(1em-0.4px)] text-[#657080]">
                            {entry.note}
                          </p>
                        )}
                        {entry.bullets.length > 0 && (
                          <ul className="m-0 mt-[4px] list-none p-0">
                            {entry.bullets.map((bullet) => (
                              <li className="relative mb-[2.4px] pl-[13px]" key={bullet.id}>
                                <span className="absolute left-px top-[0.62em] h-[1.5px] w-[5px] bg-[#4878b0]" />
                                {bullet.text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </section>
              )}

              {visibleResume.skills.length > 0 && (
                <ResumeRowsSection
                  title="Skills"
                  rows={visibleResume.skills}
                  className={density.section}
                />
              )}
              {visibleResume.education.length > 0 && (
                <ResumeRowsSection
                  title="Education"
                  rows={visibleResume.education}
                  className={density.section}
                />
              )}
            </article>
          </div>
        </div>
      </section>
    </aside>
  )
}

function ResumeSectionHeading({ children }: { children: string }) {
  return (
    <h2 className="m-0 mb-[8px] flex items-center gap-[10px] text-[10px] font-[760] uppercase leading-none tracking-[0.12em] text-[#245b9d]">
      <span>{children}</span>
      <span className="h-px flex-1 bg-[#dbe0e7]" />
    </h2>
  )
}

function ResumeDate({ children }: { children: string }) {
  return (
    <p className="m-0 flex-none whitespace-nowrap text-[calc(1em-0.55px)] tabular-nums text-[#5c6675]">
      {children}
    </p>
  )
}

function ResumeRowsSection({
  title,
  rows,
  className,
}: {
  title: string
  rows: ResumeContent['skills']
  className: string
}) {
  return (
    <section className={className}>
      <ResumeSectionHeading>{title}</ResumeSectionHeading>
      <dl className="m-0">
        {rows.map((row) => (
          <div className="mb-[3px] flex gap-3 last:mb-0" key={row.id}>
            {row.label && (
              <dt className="m-0 w-[88px] flex-none text-[calc(1em-0.15px)] font-[680] text-[#151b24]">
                {row.label}
              </dt>
            )}
            {row.value && <dd className="m-0 flex-1">{row.value}</dd>}
            {row.trailing && <ResumeDate>{row.trailing}</ResumeDate>}
          </div>
        ))}
      </dl>
    </section>
  )
}
