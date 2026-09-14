import { Document, Link, Page, pdf, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  makePublicResume,
  type ResumeContent,
  type ResumeDensity,
  type ResumeExperience,
  type ResumeRow,
} from '@repo/content/resume'

export const RESUME_PDF_FILENAME = 'brendan-eggers-resume.pdf'

interface Props {
  resume: ResumeContent
}

const colors = {
  accent: '#245b9d',
  date: '#5c6675',
  hairline: '#dbe0e7',
  ink: '#151b24',
  muted: '#657080',
  text: '#29313d',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 39,
    paddingRight: 50.25,
    paddingBottom: 34.5,
    paddingLeft: 50.25,
    backgroundColor: '#ffffff',
    color: colors.text,
    fontFamily: 'Helvetica',
  },
  name: {
    color: colors.ink,
    fontFamily: 'Helvetica-Bold',
    fontSize: 20.25,
    letterSpacing: -0.5,
    lineHeight: 1,
  },
  headline: {
    marginTop: 2.25,
    color: colors.accent,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.625,
    letterSpacing: 0.025,
  },
  contact: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 5.25,
    color: colors.date,
    fontSize: 6.75,
  },
  contactItem: {
    display: 'flex',
    flexDirection: 'row',
  },
  contactSeparator: {
    marginHorizontal: 3.75,
    color: '#a6afbb',
    fontFamily: 'Helvetica-Bold',
  },
  link: {
    color: colors.date,
    textDecoration: 'none',
  },
  summary: {
    maxWidth: 502,
    marginTop: 9,
    color: '#333c49',
  },
  sectionHeading: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitle: {
    color: colors.accent,
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    letterSpacing: 0.9,
    lineHeight: 1,
    textTransform: 'uppercase',
  },
  sectionRule: {
    flexGrow: 1,
    height: 0.75,
    marginLeft: 7.5,
    backgroundColor: colors.hairline,
  },
  entryHead: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  role: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 9,
    color: colors.ink,
    fontFamily: 'Helvetica-Bold',
  },
  organization: {
    color: colors.date,
    fontFamily: 'Helvetica',
  },
  organizationSeparator: {
    color: '#c5ccd5',
    fontFamily: 'Helvetica-Bold',
  },
  dates: {
    flexShrink: 0,
    color: colors.date,
    fontSize: 6.85,
  },
  note: {
    marginTop: 0.75,
    color: colors.muted,
    fontSize: 6.95,
  },
  bullets: {
    marginTop: 3,
  },
  bullet: {
    display: 'flex',
    flexDirection: 'row',
    marginBottom: 1.8,
  },
  bulletMark: {
    width: 3.75,
    height: 1.1,
    marginTop: 4.1,
    marginRight: 6,
    marginLeft: 0.75,
    backgroundColor: '#4878b0',
  },
  bulletText: {
    flexGrow: 1,
    flexShrink: 1,
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    marginBottom: 2.25,
  },
  rowLabel: {
    width: 66,
    flexShrink: 0,
    color: colors.ink,
    fontFamily: 'Helvetica-Bold',
  },
  rowValue: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 9,
  },
})

const densityStyles: Record<ResumeDensity, ReturnType<typeof StyleSheet.create>> = {
  comfortable: StyleSheet.create({
    page: { fontSize: 7.575, lineHeight: 1.48 },
    section: { marginTop: 10.5 },
    entry: { marginBottom: 9 },
    briefEntry: { marginBottom: 3 },
    role: { fontSize: 8.1 },
    briefRole: { fontSize: 7.65 },
  }),
  compact: StyleSheet.create({
    page: { fontSize: 7.275, lineHeight: 1.42 },
    section: { marginTop: 9 },
    entry: { marginBottom: 7.5 },
    briefEntry: { marginBottom: 3 },
    role: { fontSize: 7.8 },
    briefRole: { fontSize: 7.35 },
  }),
  tight: StyleSheet.create({
    page: { fontSize: 6.9375, lineHeight: 1.36 },
    section: { marginTop: 7.5 },
    entry: { marginBottom: 6 },
    briefEntry: { marginBottom: 3 },
    role: { fontSize: 7.46 },
    briefRole: { fontSize: 7.01 },
  }),
}

function SectionHeading({ children }: { children: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  )
}

function Experience({ entry, density }: { entry: ResumeExperience; density: ResumeDensity }) {
  const bullets = entry.bullets
  const brief = bullets.length === 0

  return (
    <View
      wrap={false}
      style={brief ? densityStyles[density].briefEntry : densityStyles[density].entry}
    >
      {entry.role || entry.organization || entry.period ? (
        <View style={styles.entryHead}>
          {entry.role || entry.organization ? (
            <Text
              style={[
                styles.role,
                brief ? densityStyles[density].briefRole : densityStyles[density].role,
              ]}
            >
              {entry.role}
              {entry.role && entry.organization ? (
                <Text style={styles.organizationSeparator}> · </Text>
              ) : null}
              {entry.organization ? (
                <Text style={styles.organization}>{entry.organization}</Text>
              ) : null}
            </Text>
          ) : null}
          {entry.period ? <Text style={styles.dates}>{entry.period}</Text> : null}
        </View>
      ) : null}
      {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
      {bullets.length > 0 ? (
        <View style={styles.bullets}>
          {bullets.map((bullet) => (
            <View key={bullet.id} style={styles.bullet}>
              <View style={styles.bulletMark} />
              <Text style={styles.bulletText}>{bullet.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function ResumeRows({ rows }: { rows: ResumeRow[] }) {
  return rows.map((row) => (
    <View key={row.id} style={styles.row} wrap={false}>
      {row.label ? <Text style={styles.rowLabel}>{row.label}</Text> : null}
      {row.value ? <Text style={styles.rowValue}>{row.value}</Text> : null}
      {row.trailing ? <Text style={styles.dates}>{row.trailing}</Text> : null}
    </View>
  ))
}

export function ResumePdfDocument({ resume }: Props) {
  const visibleResume = makePublicResume(resume)
  const experiences = visibleResume.experience
  const contactItems: { id: string; label: string; href?: string }[] = [
    { id: 'location', label: visibleResume.profile.location },
    {
      id: 'email',
      label: visibleResume.profile.email,
      href: visibleResume.profile.email ? `mailto:${visibleResume.profile.email}` : undefined,
    },
    ...visibleResume.profile.links,
  ].filter((item) => item.label.length > 0)

  return (
    <Document
      author={visibleResume.profile.name}
      creator="Career Studio"
      subject={visibleResume.profile.summary}
      title={visibleResume.profile.name ? `${visibleResume.profile.name} — Résumé` : 'Résumé'}
    >
      <Page size="LETTER" style={[styles.page, densityStyles[visibleResume.density].page]}>
        <View>
          {visibleResume.profile.name ? (
            <Text style={styles.name}>{visibleResume.profile.name}</Text>
          ) : null}
          {visibleResume.profile.headline ? (
            <Text style={styles.headline}>{visibleResume.profile.headline}</Text>
          ) : null}
          {contactItems.length > 0 ? (
            <View style={styles.contact}>
              {contactItems.map((item, index) => (
                <View key={item.id} style={styles.contactItem}>
                  {index > 0 ? <Text style={styles.contactSeparator}>·</Text> : null}
                  {item.href ? (
                    <Link src={item.href} style={styles.link}>
                      {item.label}
                    </Link>
                  ) : (
                    <Text>{item.label}</Text>
                  )}
                </View>
              ))}
            </View>
          ) : null}
          {visibleResume.profile.summary ? (
            <Text style={styles.summary}>{visibleResume.profile.summary}</Text>
          ) : null}
        </View>

        {experiences.length > 0 ? (
          <View style={densityStyles[visibleResume.density].section}>
            <SectionHeading>Experience</SectionHeading>
            {experiences.map((entry) => (
              <Experience key={entry.id} entry={entry} density={visibleResume.density} />
            ))}
          </View>
        ) : null}

        {visibleResume.skills.length > 0 ? (
          <View style={densityStyles[visibleResume.density].section}>
            <SectionHeading>Skills</SectionHeading>
            <ResumeRows rows={visibleResume.skills} />
          </View>
        ) : null}

        {visibleResume.education.length > 0 ? (
          <View style={densityStyles[visibleResume.density].section}>
            <SectionHeading>Education</SectionHeading>
            <ResumeRows rows={visibleResume.education} />
          </View>
        ) : null}
      </Page>
    </Document>
  )
}

export async function createResumePdf(resume: ResumeContent): Promise<Blob> {
  return pdf(<ResumePdfDocument resume={resume} />).toBlob()
}

export async function downloadResumePdf(resume: ResumeContent): Promise<void> {
  const blob = await createResumePdf(resume)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = RESUME_PDF_FILENAME
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
