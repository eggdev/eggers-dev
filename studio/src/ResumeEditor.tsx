import {
  claimStatuses,
  type ResumeBullet,
  type ResumeContent,
  type ResumeExperience,
  type ResumeRow,
  resumeDensities,
} from '@career/schema'
import { useState } from 'react'
import type { ResumeRecord } from '../shared'
import { withResumeData } from './api'

interface Props {
  resume: ResumeRecord
  saveStatus: string
  publishing: boolean
  onChange: (resume: ResumeRecord) => void
  onClone: () => void
  onPublish: () => void
  onPrint: () => void
}

const move = <T,>(items: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

const newBullet = (): ResumeBullet => ({
  id: crypto.randomUUID(),
  text: 'New accomplishment',
  status: 'unverified',
})

const newExperience = (): ResumeExperience => ({
  id: crypto.randomUUID(),
  role: 'Role',
  organization: 'Organization',
  period: 'Year – Year',
  bullets: [newBullet()],
})

const newRow = (): ResumeRow => ({ id: crypto.randomUUID(), label: 'Label', value: 'Details' })

export function ResumeEditor({
  resume,
  saveStatus,
  publishing,
  onChange,
  onClone,
  onPublish,
  onPrint,
}: Props) {
  const [openEntries, setOpenEntries] = useState(
    () => new Set(resume.data.experience.slice(0, 3).map((entry) => entry.id))
  )
  const updateData = (data: ResumeContent) => onChange(withResumeData(resume, data))
  const updateExperience = (index: number, entry: ResumeExperience) => {
    const experience = [...resume.data.experience]
    experience[index] = entry
    updateData({ ...resume.data, experience })
  }
  const updateRows = (key: 'skills' | 'education', rows: ResumeRow[]) =>
    updateData({ ...resume.data, [key]: rows })
  const unverifiedCount = resume.data.experience.reduce(
    (total, entry) =>
      total +
      entry.bullets.filter(
        (bullet) => !entry.hidden && !bullet.hidden && bullet.status === 'unverified'
      ).length,
    0
  )

  return (
    <div className="resume-editor">
      <header className="resume-editor__toolbar">
        <div className="resume-title-group">
          <input
            aria-label="Résumé title"
            className="resume-title-input"
            value={resume.title}
            onChange={(event) => onChange({ ...resume, title: event.target.value })}
          />
          <span className={`save-state save-state--${saveStatus.toLowerCase().replace(' ', '-')}`}>
            {saveStatus}
          </span>
        </div>
        <div className="toolbar-actions">
          <button className="button button--quiet" type="button" onClick={onClone}>
            Duplicate
          </button>
          <button className="button button--quiet" type="button" onClick={onPrint}>
            Export PDF
          </button>
          {resume.isCanonical ? (
            <button
              className="button button--primary"
              type="button"
              disabled={publishing || unverifiedCount > 0}
              onClick={onPublish}
              title={
                unverifiedCount > 0
                  ? `${unverifiedCount} unverified claim${unverifiedCount === 1 ? '' : 's'} must be resolved`
                  : undefined
              }
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          ) : null}
        </div>
      </header>

      {unverifiedCount > 0 ? (
        <p className="validation-note">
          {unverifiedCount} unverified claim{unverifiedCount === 1 ? '' : 's'} — publishing stays
          locked until each is resolved or hidden.
        </p>
      ) : null}

      <fieldset className="density-control">
        <legend>Page density</legend>
        {resumeDensities.map((density) => (
          <label key={density}>
            <input
              type="radio"
              name="density"
              checked={resume.data.density === density}
              onChange={() => updateData({ ...resume.data, density })}
            />
            <span>{density}</span>
          </label>
        ))}
      </fieldset>

      <section className="form-section">
        <div className="form-section__heading">
          <div>
            <p className="eyebrow">Identity</p>
            <h2>Profile</h2>
          </div>
        </div>
        <div className="field-grid field-grid--two">
          <label className="field">
            <span>Name</span>
            <input
              value={resume.data.profile.name}
              onChange={(event) =>
                updateData({
                  ...resume.data,
                  profile: { ...resume.data.profile, name: event.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>Headline</span>
            <input
              value={resume.data.profile.headline}
              onChange={(event) =>
                updateData({
                  ...resume.data,
                  profile: { ...resume.data.profile, headline: event.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>Location</span>
            <input
              value={resume.data.profile.location}
              onChange={(event) =>
                updateData({
                  ...resume.data,
                  profile: { ...resume.data.profile, location: event.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={resume.data.profile.email}
              onChange={(event) =>
                updateData({
                  ...resume.data,
                  profile: { ...resume.data.profile, email: event.target.value },
                })
              }
            />
          </label>
        </div>
        <label className="field">
          <span>Summary</span>
          <textarea
            rows={4}
            value={resume.data.profile.summary}
            onChange={(event) =>
              updateData({
                ...resume.data,
                profile: { ...resume.data.profile, summary: event.target.value },
              })
            }
          />
        </label>
        <div className="subsection">
          <div className="subsection__heading">
            <h3>Links</h3>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                updateData({
                  ...resume.data,
                  profile: {
                    ...resume.data.profile,
                    links: [
                      ...resume.data.profile.links,
                      {
                        id: crypto.randomUUID(),
                        label: 'example.com',
                        href: 'https://example.com',
                      },
                    ],
                  },
                })
              }
            >
              Add link
            </button>
          </div>
          {resume.data.profile.links.map((link, index) => (
            <div className="inline-row" key={link.id}>
              <input
                aria-label={`Link ${index + 1} label`}
                value={link.label}
                onChange={(event) => {
                  const links = [...resume.data.profile.links]
                  links[index] = { ...link, label: event.target.value }
                  updateData({ ...resume.data, profile: { ...resume.data.profile, links } })
                }}
              />
              <input
                aria-label={`Link ${index + 1} URL`}
                value={link.href}
                onChange={(event) => {
                  const links = [...resume.data.profile.links]
                  links[index] = { ...link, href: event.target.value }
                  updateData({ ...resume.data, profile: { ...resume.data.profile, links } })
                }}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove ${link.label}`}
                onClick={() =>
                  updateData({
                    ...resume.data,
                    profile: {
                      ...resume.data.profile,
                      links: resume.data.profile.links.filter(
                        (_, itemIndex) => itemIndex !== index
                      ),
                    },
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="form-section">
        <div className="form-section__heading">
          <div>
            <p className="eyebrow">Selected history</p>
            <h2>Experience</h2>
          </div>
          <button
            className="button button--quiet"
            type="button"
            onClick={() =>
              updateData({
                ...resume.data,
                experience: [...resume.data.experience, newExperience()],
              })
            }
          >
            Add role
          </button>
        </div>
        <div className="entry-editor-list">
          {resume.data.experience.map((entry, index) => (
            <details
              className={`entry-editor ${entry.hidden ? 'is-hidden' : ''}`}
              key={entry.id}
              open={openEntries.has(entry.id)}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open
                setOpenEntries((current) => {
                  const next = new Set(current)
                  if (isOpen) next.add(entry.id)
                  else next.delete(entry.id)
                  return next
                })
              }}
            >
              <summary>
                <span>
                  <strong>{entry.role || 'Untitled role'}</strong>
                  <small>{entry.organization}</small>
                </span>
                <span className="entry-editor__summary-meta">
                  {entry.hidden ? 'Hidden' : entry.period}
                </span>
              </summary>
              <div className="entry-editor__body">
                <div className="entry-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Move role up"
                    disabled={index === 0}
                    onClick={() =>
                      updateData({
                        ...resume.data,
                        experience: move(resume.data.experience, index, -1),
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Move role down"
                    disabled={index === resume.data.experience.length - 1}
                    onClick={() =>
                      updateData({
                        ...resume.data,
                        experience: move(resume.data.experience, index, 1),
                      })
                    }
                  >
                    ↓
                  </button>
                  <label className="visibility-toggle">
                    <input
                      type="checkbox"
                      checked={!entry.hidden}
                      onChange={(event) =>
                        updateExperience(index, { ...entry, hidden: !event.target.checked })
                      }
                    />
                    Included
                  </label>
                </div>
                <div className="field-grid field-grid--two">
                  <label className="field">
                    <span>Role</span>
                    <input
                      value={entry.role}
                      onChange={(event) =>
                        updateExperience(index, { ...entry, role: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Organization</span>
                    <input
                      value={entry.organization}
                      onChange={(event) =>
                        updateExperience(index, { ...entry, organization: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Period</span>
                    <input
                      value={entry.period}
                      onChange={(event) =>
                        updateExperience(index, { ...entry, period: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Context note</span>
                    <input
                      value={entry.note ?? ''}
                      onChange={(event) =>
                        updateExperience(index, { ...entry, note: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="subsection">
                  <div className="subsection__heading">
                    <h3>Accomplishments</h3>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        updateExperience(index, {
                          ...entry,
                          bullets: [...entry.bullets, newBullet()],
                        })
                      }
                    >
                      Add accomplishment
                    </button>
                  </div>
                  <div className="bullet-editor-list">
                    {entry.bullets.map((bullet, bulletIndex) => (
                      <div
                        className={`bullet-editor ${bullet.hidden ? 'is-hidden' : ''}`}
                        key={bullet.id}
                      >
                        <div className="bullet-editor__controls">
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="Move accomplishment up"
                            disabled={bulletIndex === 0}
                            onClick={() =>
                              updateExperience(index, {
                                ...entry,
                                bullets: move(entry.bullets, bulletIndex, -1),
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="Move accomplishment down"
                            disabled={bulletIndex === entry.bullets.length - 1}
                            onClick={() =>
                              updateExperience(index, {
                                ...entry,
                                bullets: move(entry.bullets, bulletIndex, 1),
                              })
                            }
                          >
                            ↓
                          </button>
                          <label className="visibility-toggle">
                            <input
                              type="checkbox"
                              checked={!bullet.hidden}
                              onChange={(event) => {
                                const bullets = [...entry.bullets]
                                bullets[bulletIndex] = { ...bullet, hidden: !event.target.checked }
                                updateExperience(index, { ...entry, bullets })
                              }}
                            />
                            Included
                          </label>
                        </div>
                        <textarea
                          aria-label={`Accomplishment ${bulletIndex + 1}`}
                          rows={3}
                          value={bullet.text}
                          onChange={(event) => {
                            const bullets = [...entry.bullets]
                            bullets[bulletIndex] = { ...bullet, text: event.target.value }
                            updateExperience(index, { ...entry, bullets })
                          }}
                        />
                        <div className="bullet-editor__meta">
                          <label>
                            <span>Provenance</span>
                            <select
                              value={bullet.status}
                              onChange={(event) => {
                                const bullets = [...entry.bullets]
                                bullets[bulletIndex] = {
                                  ...bullet,
                                  status: event.target.value as ResumeBullet['status'],
                                }
                                updateExperience(index, { ...entry, bullets })
                              }}
                            >
                              {claimStatuses.map((status) => (
                                <option value={status} key={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="evidence-field">
                            <span>Private evidence note</span>
                            <input
                              placeholder="Commit, source, or context"
                              value={bullet.evidence ?? ''}
                              onChange={(event) => {
                                const bullets = [...entry.bullets]
                                bullets[bulletIndex] = { ...bullet, evidence: event.target.value }
                                updateExperience(index, { ...entry, bullets })
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    {entry.bullets.length === 0 ? (
                      <p className="empty-inline">This role renders as a compact one-line entry.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {(['skills', 'education'] as const).map((key) => {
        const rows = resume.data[key]
        const title = key === 'skills' ? 'Skills' : 'Education'
        return (
          <section className="form-section" key={key}>
            <div className="form-section__heading">
              <div>
                <p className="eyebrow">Structured rows</p>
                <h2>{title}</h2>
              </div>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => updateRows(key, [...rows, newRow()])}
              >
                Add row
              </button>
            </div>
            <div className="row-editor-list">
              {rows.map((row, index) => (
                <div className={`row-editor ${row.hidden ? 'is-hidden' : ''}`} key={row.id}>
                  <div className="row-editor__controls">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Move ${row.label} up`}
                      disabled={index === 0}
                      onClick={() => updateRows(key, move(rows, index, -1))}
                    >
                      ↑
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Move ${row.label} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => updateRows(key, move(rows, index, 1))}
                    >
                      ↓
                    </button>
                    <label className="visibility-toggle">
                      <input
                        type="checkbox"
                        checked={!row.hidden}
                        onChange={(event) => {
                          const next = [...rows]
                          next[index] = { ...row, hidden: !event.target.checked }
                          updateRows(key, next)
                        }}
                      />
                      Included
                    </label>
                  </div>
                  <input
                    aria-label={`${title} row label`}
                    value={row.label}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, label: event.target.value }
                      updateRows(key, next)
                    }}
                  />
                  <textarea
                    aria-label={`${title} row details`}
                    rows={2}
                    value={row.value}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...row, value: event.target.value }
                      updateRows(key, next)
                    }}
                  />
                  {key === 'education' ? (
                    <input
                      aria-label={`${title} row trailing value`}
                      placeholder="Year"
                      value={row.trailing ?? ''}
                      onChange={(event) => {
                        const next = [...rows]
                        next[index] = { ...row, trailing: event.target.value }
                        updateRows(key, next)
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
