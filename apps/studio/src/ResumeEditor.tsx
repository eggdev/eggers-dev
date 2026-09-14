import {
  type ResumeBullet,
  type ResumeContent,
  type ResumeExperience,
  type ResumeRow,
  resumeDensities,
} from '@repo/content'
import { Button } from '@repo/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { Select } from '@repo/ui/select'
import { Textarea } from '@repo/ui/textarea'
import { useState } from 'react'

interface Props {
  resume: ResumeContent
  onChange: (resume: ResumeContent) => void
}

const move = <T,>(items: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

const newBullet = (): ResumeBullet => ({ id: crypto.randomUUID(), text: '' })

const newExperience = (): ResumeExperience => ({
  id: crypto.randomUUID(),
  role: '',
  organization: '',
  period: '',
  bullets: [],
})

const newRow = (): ResumeRow => ({ id: crypto.randomUUID(), label: '', value: '' })

function IncludedToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Label className="flex cursor-pointer grid-cols-[auto_1fr] items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Included
    </Label>
  )
}

function OrderButtons({
  label,
  index,
  length,
  onMove,
}: {
  label: string
  index: number
  length: number
  onMove: (direction: -1 | 1) => void
}) {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        aria-label={`Move ${label} down`}
        disabled={index === length - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
    </div>
  )
}

export function ResumeEditor({ resume, onChange }: Props) {
  const [openEntries, setOpenEntries] = useState(
    () => new Set(resume.experience.slice(0, 3).map((entry) => entry.id))
  )

  const updateExperience = (index: number, entry: ResumeExperience) => {
    const experience = [...resume.experience]
    experience[index] = entry
    onChange({ ...resume, experience })
  }

  const updateRows = (key: 'skills' | 'education', rows: ResumeRow[]) =>
    onChange({ ...resume, [key]: rows })

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Résumé profile</CardTitle>
          <CardDescription>
            Blank fields stay editable in the draft and disappear from every rendered version.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Label className="max-w-56">
            Page density
            <Select
              value={resume.density}
              onChange={(event) =>
                onChange({
                  ...resume,
                  density: event.target.value as ResumeContent['density'],
                })
              }
            >
              {resumeDensities.map((density) => (
                <option key={density} value={density}>
                  {density[0].toUpperCase() + density.slice(1)}
                </option>
              ))}
            </Select>
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['name', 'headline', 'location', 'email'] as const).map((key) => (
              <Label key={key} className="capitalize">
                {key}
                <Input
                  type={key === 'email' ? 'email' : 'text'}
                  value={resume.profile[key]}
                  onChange={(event) =>
                    onChange({
                      ...resume,
                      profile: { ...resume.profile, [key]: event.target.value },
                    })
                  }
                />
              </Label>
            ))}
          </div>
          <Label>
            Summary
            <Textarea
              value={resume.profile.summary}
              onChange={(event) =>
                onChange({
                  ...resume,
                  profile: { ...resume.profile, summary: event.target.value },
                })
              }
            />
          </Label>
          <div className="grid gap-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Links</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    ...resume,
                    profile: {
                      ...resume.profile,
                      links: [
                        ...resume.profile.links,
                        { id: crypto.randomUUID(), label: '', href: '' },
                      ],
                    },
                  })
                }
              >
                Add link
              </Button>
            </div>
            {resume.profile.links.map((link, index) => (
              <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.45fr)_1fr_auto]" key={link.id}>
                <Input
                  aria-label={`Link ${index + 1} label`}
                  placeholder="Label"
                  value={link.label}
                  onChange={(event) => {
                    const links = [...resume.profile.links]
                    links[index] = { ...link, label: event.target.value }
                    onChange({ ...resume, profile: { ...resume.profile, links } })
                  }}
                />
                <Input
                  aria-label={`Link ${index + 1} URL`}
                  placeholder="https://example.com"
                  value={link.href}
                  onChange={(event) => {
                    const links = [...resume.profile.links]
                    links[index] = { ...link, href: event.target.value }
                    onChange({ ...resume, profile: { ...resume.profile, links } })
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${link.label || `link ${index + 1}`}`}
                  onClick={() =>
                    onChange({
                      ...resume,
                      profile: {
                        ...resume.profile,
                        links: resume.profile.links.filter((_, itemIndex) => itemIndex !== index),
                      },
                    })
                  }
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Experience</h2>
          <p className="text-sm text-muted-foreground">
            Order, visibility, context, and accomplishments.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ ...resume, experience: [...resume.experience, newExperience()] })
          }
        >
          Add role
        </Button>
      </div>

      {resume.experience.map((entry, index) => (
        <details
          className={`rounded-lg border bg-card text-card-foreground ${entry.hidden ? 'opacity-55' : ''}`}
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
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:hidden">
            <span className="min-w-0">
              <strong className="block truncate text-sm font-semibold">
                {entry.role || entry.organization || 'Untitled role'}
              </strong>
              <small className="block truncate text-xs text-muted-foreground">
                {entry.hidden
                  ? 'Hidden'
                  : entry.organization || entry.period || 'Empty fields are omitted'}
              </small>
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              ⌄
            </span>
          </summary>
          <div className="grid gap-4 border-t p-5">
            <div className="flex flex-wrap items-center gap-2">
              <OrderButtons
                label={entry.role || 'role'}
                index={index}
                length={resume.experience.length}
                onMove={(direction) =>
                  onChange({ ...resume, experience: move(resume.experience, index, direction) })
                }
              />
              <IncludedToggle
                checked={!entry.hidden}
                onChange={(checked) => updateExperience(index, { ...entry, hidden: !checked })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() =>
                  onChange({
                    ...resume,
                    experience: resume.experience.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                Remove role
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['role', 'organization', 'period'] as const).map((key) => (
                <Label key={key} className="capitalize">
                  {key}
                  <Input
                    value={entry[key]}
                    onChange={(event) =>
                      updateExperience(index, { ...entry, [key]: event.target.value })
                    }
                  />
                </Label>
              ))}
              <Label>
                Context note
                <Input
                  value={entry.note ?? ''}
                  onChange={(event) =>
                    updateExperience(index, { ...entry, note: event.target.value })
                  }
                />
              </Label>
            </div>
            <div className="grid gap-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Accomplishments</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateExperience(index, { ...entry, bullets: [...entry.bullets, newBullet()] })
                  }
                >
                  Add accomplishment
                </Button>
              </div>
              {entry.bullets.map((bullet, bulletIndex) => (
                <div
                  className={`grid gap-2 rounded-md border p-3 ${bullet.hidden ? 'opacity-55' : ''}`}
                  key={bullet.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderButtons
                      label={`accomplishment ${bulletIndex + 1}`}
                      index={bulletIndex}
                      length={entry.bullets.length}
                      onMove={(direction) =>
                        updateExperience(index, {
                          ...entry,
                          bullets: move(entry.bullets, bulletIndex, direction),
                        })
                      }
                    />
                    <IncludedToggle
                      checked={!bullet.hidden}
                      onChange={(checked) => {
                        const bullets = [...entry.bullets]
                        bullets[bulletIndex] = { ...bullet, hidden: !checked }
                        updateExperience(index, { ...entry, bullets })
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() =>
                        updateExperience(index, {
                          ...entry,
                          bullets: entry.bullets.filter(
                            (_, itemIndex) => itemIndex !== bulletIndex
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <Textarea
                    aria-label={`Accomplishment ${bulletIndex + 1}`}
                    className="min-h-20"
                    value={bullet.text}
                    onChange={(event) => {
                      const bullets = [...entry.bullets]
                      bullets[bulletIndex] = { ...bullet, text: event.target.value }
                      updateExperience(index, { ...entry, bullets })
                    }}
                  />
                </div>
              ))}
              {entry.bullets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  With no other content, this role disappears; with role details only, it renders
                  compactly.
                </p>
              )}
            </div>
          </div>
        </details>
      ))}

      {(['skills', 'education'] as const).map((key) => {
        const rows = resume[key]
        const title = key === 'skills' ? 'Skills' : 'Education'
        return (
          <Card key={key}>
            <CardHeader className="flex-row items-end justify-between gap-3">
              <div className="grid gap-1.5">
                <CardTitle>{title}</CardTitle>
                <CardDescription>
                  Blank rows disappear from preview and publication.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateRows(key, [...rows, newRow()])}
              >
                Add row
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {rows.map((row, index) => (
                <div
                  className={`grid gap-2 rounded-md border p-3 ${row.hidden ? 'opacity-55' : ''}`}
                  key={row.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderButtons
                      label={row.label || `${title} row ${index + 1}`}
                      index={index}
                      length={rows.length}
                      onMove={(direction) => updateRows(key, move(rows, index, direction))}
                    />
                    <IncludedToggle
                      checked={!row.hidden}
                      onChange={(checked) => {
                        const next = [...rows]
                        next[index] = { ...row, hidden: !checked }
                        updateRows(key, next)
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() =>
                        updateRows(
                          key,
                          rows.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <div
                    className={`grid gap-2 ${key === 'education' ? 'sm:grid-cols-[8rem_1fr_6rem]' : 'sm:grid-cols-[8rem_1fr]'}`}
                  >
                    <Input
                      aria-label={`${title} row label`}
                      placeholder="Label"
                      value={row.label}
                      onChange={(event) => {
                        const next = [...rows]
                        next[index] = { ...row, label: event.target.value }
                        updateRows(key, next)
                      }}
                    />
                    <Textarea
                      aria-label={`${title} row details`}
                      className="min-h-16"
                      placeholder="Details"
                      value={row.value}
                      onChange={(event) => {
                        const next = [...rows]
                        next[index] = { ...row, value: event.target.value }
                        updateRows(key, next)
                      }}
                    />
                    {key === 'education' && (
                      <Input
                        aria-label={`${title} row trailing value`}
                        placeholder="Year"
                        value={row.trailing ?? ''}
                        onChange={(event) => {
                          const next = [...rows]
                          next[index] = { ...row, trailing: event.target.value }
                          updateRows(key, next)
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
