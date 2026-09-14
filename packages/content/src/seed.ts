import resumeSource from '@repo/content/public-resume'
import { type PublicSiteContent, validatePublicSiteContent } from '@repo/content/site'

const seedCandidate = {
  version: 1,
  seo: {
    title: 'Brendan Eggers — Co-Founder & Director of Software Engineering',
    description:
      'Brendan Eggers takes ambiguous products from the user problem to the system that runs them in production. Co-Founder/CTO of Bar Savvy, Director of Software Engineering at LV Collective, ex-NBA.',
    ogAlt: 'Brendan Eggers — Co-Founder & Director of Software Engineering',
  },
  identity: {
    name: 'Brendan Eggers',
    siteLabel: 'eggers.dev',
    email: 'brendan@eggers.dev',
    role: 'Director, Software Engineering',
    summary:
      'Product engineer who takes ambiguous products from the user problem to the system that runs them in production.',
    location: 'Connecticut (NYC metro)',
    socials: [
      { label: 'GitHub', handle: 'eggdev', href: 'https://github.com/eggdev' },
      { label: 'X', handle: 'egggdev', href: 'https://x.com/egggdev' },
      {
        label: 'LinkedIn',
        handle: 'brendaneggers',
        href: 'https://linkedin.com/in/brendaneggers',
      },
    ],
  },
  navigation: [
    { href: '#work', label: 'Work', shortLabel: 'Work' },
    { href: '#ai', label: 'How I work', shortLabel: 'AI' },
    { href: '#about', label: 'About', shortLabel: 'About' },
    { href: '#contact', label: 'Contact', shortLabel: 'Contact' },
    { href: '/resume', label: 'Résumé', shortLabel: 'CV' },
  ],
  work: {
    stories: [
      {
        id: 'bar-savvy',
        title: 'Bar Savvy',
        role: 'Co-Founder / CTO',
        period: '2023 to present',
        opening:
          'Bar Savvy started with a public record most people don’t know exists: Texas publishes what every bar sells in alcohol, every month, by venue. In 2023 I was still working at the NBA, and as a side project on my own machine I started joining that record with public venue data and putting the result on a map. If you were thinking about opening a bar, you could pull up a neighborhood and see what the bars already there actually sold, not what they claimed. That map was the whole first product.',
        detail:
          'Sole continuous engineer across the web and native apps, the data engine, and the infrastructure. Paying customers; revenue covers operating costs.',
        links: [{ label: 'barsavvy.com', href: 'https://barsavvy.com' }],
      },
      {
        id: 'lv-collective',
        title: 'LV Collective',
        role: 'Director, Software Engineering',
        period: '2024 to present',
        opening:
          'LV Collective is where Bar Savvy is incubated and where the rest of my week goes. I led Sidekick OS, a private knowledge system for executives, and shipped upcredit, a small rent-credit product that runs across the student-housing portfolio with little upkeep. About half the role is teaching the rest of the org to build with AI without me in the loop.',
        detail:
          'Office hours and formal lessons grew into the AI Builders Committee; colleagues now run their own workflows and automations.',
        links: [{ label: 'lvcollective.com', href: 'https://lvcollective.com' }],
      },
      {
        id: 'nba',
        title: 'NBA',
        role: 'Senior Software Engineer, Direct-to-Consumer',
        period: '2022 to 2024',
        opening:
          'When someone buys NBA League Pass and presses play, the game either starts or it doesn’t. Behind that press sits a chain: an account, a purchase, and a system deciding this person gets this game. I joined the NBA’s NextGen rewrite working on that chain, from signing in and paying through to watching.',
        detail:
          'Built the live-scores surface from its first commit, led client-side identity and entitlements across web and connected devices, and helped launch Local Access in-market streaming.',
        links: [{ label: 'League Pass', href: 'https://www.nba.com/league-pass-purchase' }],
      },
      {
        id: 'eggers-wedding',
        title: 'eggers.wedding',
        role: 'Personal build, with Emina',
        period: 'In active use',
        opening:
          'Every deadline I’ve shipped against professionally had some give in it, even when nobody admitted it. A wedding date doesn’t. Ours is fixed, the guests are real, and the software we’re planning it with is software I built.',
        detail:
          'Guest information, group RSVPs and admin, seating, Spotify music, and honeymoon planning in one system Emina and I run our whole wedding from.',
        links: [{ label: 'eggers.wedding', href: 'https://eggers.wedding' }],
      },
    ],
  },
  process: {
    heading: 'How I work',
    introduction:
      "I use AI where a product needs judgment rules can't provide, where failure can be surfaced and recovered, and where I can observe enough of the system to improve it in production. The agents that build with me work the same way: inside rules they can't break.",
    points: [
      {
        heading: 'The harness',
        body: "AST-level lint rules, an auto-ratcheting merge policy, and guardrail hooks the agents can't edit. The rules hold even when I'm the one asking.",
      },
      {
        heading: 'The night shift',
        body: 'An autonomous loop opens small cleanup PRs and merges the ones that pass every gate, overnight, unattended.',
      },
      {
        heading: 'Cross-model review',
        body: 'Claude plans, triages, and verifies. Codex implements and plays the skeptical reviewer, then Claude re-checks those findings against the code.',
      },
      {
        heading: 'The human gate',
        body: 'Nothing reaches a person until it has passed everything I would have checked myself. Commit, never push.',
      },
    ],
    harnessCode: `// .harness/hooks.ts — the line agents can't cross
preToolUse((action) => {
  if (editsGuardrails(action) || usesNoVerify(action)) {
    return block("guardrails and CI bypass are off-limits")
  }
})

// quality only ratchets one direction
mergePolicy({
  required: ["typecheck", "unit", "e2e", "codex-review"],
  ratchet: "auto",
  humanGate: "commit-never-push",
})`,
    harnessCaption: 'A sketch of the harness I carry between projects.',
    harnessUrl: '',
    diagramCaption:
      'Every night the harness runs the loop on its own: plan, review, build, test, looping back at each gate until the work passes.',
  },
  about: {
    heading: 'About',
    paragraphs: [
      "Give me the hard, ambiguous product. I'll take it from the user problem through the system that runs it in production. At the NBA that meant the live score strip, built from its first commit, and the path from sign-in to game access. At Bar Savvy it means everything, since I'm often the only engineer. I've done that alongside my work at LV Collective, where I now spend as much time teaching AI as I do building.",
      "I build this way because it lets a small team move like a much larger one, without the mess that usually comes with moving fast. It's why the people I hand this to start shipping work they couldn't before. The harness is what makes the speed safe enough to trust.",
    ],
  },
  contact: {
    heading: 'Contact',
    introduction: 'Always glad to meet people building this way. The fastest way to reach me:',
  },
  footer: { note: 'Brendan Eggers', backToTopLabel: 'Back to top' },
  resume: resumeSource,
}

const validated = validatePublicSiteContent(seedCandidate)
if (!validated.data) {
  throw new Error(`Invalid public content seed: ${validated.errors.join('; ')}`)
}

export const publicContentSeed: PublicSiteContent = validated.data
