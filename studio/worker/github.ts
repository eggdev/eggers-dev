import type { ResumeContent } from '@career/schema'
import { importPKCS8, SignJWT } from 'jose'
import { convertRsaPrivateKeyToPkcs8Pem } from './pkcs8'

interface GitHubFileResponse {
  sha: string
}

export interface GitHubCommit {
  sha: string
  url: string
}

const apiHeaders = (token: string): HeadersInit => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'eggers-career-studio',
  'X-GitHub-Api-Version': '2022-11-28',
})

const readJson = async (response: Response): Promise<unknown> => {
  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > 1_000_000) throw new Error('GitHub returned an unexpectedly large response')
  return response.json()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function getInstallationToken(env: Env): Promise<string> {
  if (!env.GITHUB_PRIVATE_KEY) throw new Error('GITHUB_PRIVATE_KEY is not configured')
  const appId: string = env.GITHUB_APP_ID
  const installationId: string = env.GITHUB_INSTALLATION_ID
  if (appId === 'REPLACE_ME' || installationId === 'REPLACE_ME') {
    throw new Error('GitHub App variables are not configured')
  }

  const key = await importPKCS8(convertRsaPrivateKeyToPkcs8Pem(env.GITHUB_PRIVATE_KEY), 'RS256')
  const now = Math.floor(Date.now() / 1_000)
  const appJwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId)
    .sign(key)

  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    { method: 'POST', headers: apiHeaders(appJwt) }
  )
  const payload = await readJson(response)
  if (!response.ok || !isRecord(payload) || typeof payload.token !== 'string') {
    throw new Error(`GitHub App authentication failed (${response.status})`)
  }
  return payload.token
}

const encodeBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192))
  }
  return btoa(binary)
}

export async function publishResumeToGitHub(
  env: Env,
  title: string,
  resume: ResumeContent
): Promise<GitHubCommit> {
  const token = await getInstallationToken(env)
  const repository = `${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`
  const path = env.GITHUB_CONTENT_PATH.split('/').map(encodeURIComponent).join('/')
  const fileUrl = `https://api.github.com/repos/${repository}/contents/${path}`

  const currentResponse = await fetch(`${fileUrl}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, {
    headers: apiHeaders(token),
  })
  const currentPayload = await readJson(currentResponse)
  if (!currentResponse.ok || !isRecord(currentPayload) || typeof currentPayload.sha !== 'string') {
    throw new Error(`Could not read the current résumé projection (${currentResponse.status})`)
  }
  const current: GitHubFileResponse = { sha: currentPayload.sha }

  const content = `${JSON.stringify(resume, null, 2)}\n`
  const updateResponse = await fetch(fileUrl, {
    method: 'PUT',
    headers: apiHeaders(token),
    body: JSON.stringify({
      message: `content(resume): publish ${title}`,
      content: encodeBase64(content),
      sha: current.sha,
      branch: env.GITHUB_BRANCH,
    }),
  })
  const updatePayload = await readJson(updateResponse)
  const commit =
    isRecord(updatePayload) && isRecord(updatePayload.commit) ? updatePayload.commit : null
  if (
    !updateResponse.ok ||
    !commit ||
    typeof commit.sha !== 'string' ||
    typeof commit.html_url !== 'string'
  ) {
    throw new Error(`GitHub rejected the résumé publish (${updateResponse.status})`)
  }
  return { sha: commit.sha, url: commit.html_url }
}
