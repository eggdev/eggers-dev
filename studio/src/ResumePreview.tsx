import type { ResumeContent } from '@career/schema'
import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  resume: ResumeContent
}

export function ResumePreview({ resume }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const [scale, setScale] = useState(0.7)
  const [overflowing, setOverflowing] = useState(false)
  const experiences = resume.experience.filter((entry) => !entry.hidden)
  const skills = resume.skills.filter((row) => !row.hidden)
  const education = resume.education.filter((row) => !row.hidden)
  const hasSelfReported = experiences.some((entry) =>
    entry.bullets.some((bullet) => !bullet.hidden && bullet.status === 'self-reported')
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const page = pageRef.current
    if (!viewport || !page) return
    const measure = () => {
      setScale(Math.min(1, Math.max(0.35, (viewport.clientWidth - 32) / 816)))
      setOverflowing(page.scrollHeight > page.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(page)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className="resume-preview-viewport"
      ref={viewportRef}
      style={{ height: `${1056 * scale + 32}px` }}
    >
      {overflowing ? <p className="overflow-warning">Content exceeds one page</p> : null}
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
                      <li key={bullet.id}>
                        {bullet.text}
                        {bullet.status === 'self-reported' ? <sup>*</sup> : null}
                      </li>
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
        {hasSelfReported ? <p className="resume-page__provenance">* Self-reported</p> : null}
      </article>
    </div>
  )
}
