import type { ResumeContent } from '@career/schema'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
}

type Zoom = 'fit' | number

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export function ResumePreview({ resume, publicUrl, expanded, onExpandedChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const [fitScale, setFitScale] = useState(0.7)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [overflowing, setOverflowing] = useState(false)
  const scale = zoom === 'fit' ? fitScale : zoom
  const experiences = resume.experience.filter((entry) => !entry.hidden)
  const skills = resume.skills.filter((row) => !row.hidden)
  const education = resume.education.filter((row) => !row.hidden)

  useLayoutEffect(() => {
    const scrollport = scrollRef.current
    if (!scrollport) return
    const measure = () => {
      const availableWidth = Math.max(0, scrollport.clientWidth - 32)
      setFitScale(clampScale(Math.min(1, availableWidth / PAGE_WIDTH)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scrollport)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const page = pageRef.current
    if (!page) return
    setOverflowing(page.scrollHeight > page.clientHeight + 1)
  })

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

  const scaledWidth = Math.ceil(PAGE_WIDTH * scale)
  const scaledHeight = Math.ceil(PAGE_HEIGHT * scale)

  return (
    <div className="resume-preview">
      <div className="preview-pane__header">
        <div>
          <span>Live preview</span>
          <small>Letter · {resume.density}</small>
        </div>
        <div className="preview-pane__actions">
          <fieldset className="preview-zoom">
            <legend className="visually-hidden">Preview zoom</legend>
            <button
              type="button"
              className={zoom === 'fit' ? 'is-active' : ''}
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
            >
              Fit
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={scale <= MIN_SCALE}
              onClick={() => changeZoom(-1)}
            >
              −
            </button>
            <output aria-label="Preview zoom">{Math.round(scale * 100)}%</output>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={scale >= MAX_SCALE}
              onClick={() => changeZoom(1)}
            >
              +
            </button>
          </fieldset>
          {publicUrl ? (
            <a href={publicUrl} target="_blank" rel="noreferrer">
              Public ↗
            </a>
          ) : null}
          <button
            className="preview-expand"
            type="button"
            aria-pressed={expanded}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? 'Close' : 'Expand'}
          </button>
        </div>
      </div>

      <section
        className="resume-preview-scroll"
        ref={scrollRef}
        // A scrollable preview needs keyboard focus so arrow and page keys work.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: intentional scroll-region focus target
        tabIndex={0}
        aria-label="Scrollable résumé page preview"
      >
        <div
          className="resume-preview-canvas"
          style={{ width: `${scaledWidth + 32}px`, height: `${scaledHeight + 32}px` }}
        >
          {overflowing ? <p className="overflow-warning">Content exceeds one page</p> : null}
          <div
            className="resume-preview-frame"
            style={{ width: `${scaledWidth}px`, height: `${scaledHeight}px` }}
          >
            <article
              className={`resume-page resume-page--${resume.density}`}
              id="resume-preview"
              ref={pageRef}
              style={{ transform: `scale(${scale})` }}
            >
              <header className="resume-page__header">
                <h1>{resume.profile.name}</h1>
                <p className="resume-page__headline">{resume.profile.headline}</p>
                <p className="resume-page__contact">
                  <span>{resume.profile.location}</span>
                  <span>{resume.profile.email}</span>
                  {resume.profile.links.map((link) => (
                    <span key={link.id}>{link.label}</span>
                  ))}
                </p>
                <p className="resume-page__summary">{resume.profile.summary}</p>
              </header>

              <section>
                <h2>Experience</h2>
                {experiences.map((entry) => {
                  const bullets = entry.bullets.filter((bullet) => !bullet.hidden)
                  return (
                    <div
                      className={`resume-page__entry ${bullets.length === 0 ? 'resume-page__entry--brief' : ''}`}
                      key={entry.id}
                    >
                      <div className="resume-page__entry-head">
                        <h3>
                          {entry.role}
                          <span>{entry.organization}</span>
                        </h3>
                        <p>{entry.period}</p>
                      </div>
                      {entry.note ? <p className="resume-page__note">{entry.note}</p> : null}
                      {bullets.length > 0 ? (
                        <ul>
                          {bullets.map((bullet) => (
                            <li key={bullet.id}>{bullet.text}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )
                })}
              </section>

              <section>
                <h2>Skills</h2>
                <dl>
                  {skills.map((row) => (
                    <div className="resume-page__row" key={row.id}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                      {row.trailing ? <dd className="resume-page__date">{row.trailing}</dd> : null}
                    </div>
                  ))}
                </dl>
              </section>

              <section>
                <h2>Education</h2>
                <dl>
                  {education.map((row) => (
                    <div className="resume-page__row" key={row.id}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                      {row.trailing ? <dd className="resume-page__date">{row.trailing}</dd> : null}
                    </div>
                  ))}
                </dl>
              </section>
            </article>
          </div>
        </div>
      </section>
    </div>
  )
}
