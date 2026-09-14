import { expect, test } from '@playwright/test'

test('public web renders the checked-in publication fallback', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:4321/')
  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { name: 'Brendan Eggers', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Work', level: 2 })).toBeVisible()
})

test('Studio serves its Access-protected CMS through the Worker', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:5173/')
  expect(response?.ok()).toBe(true)
  expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
  await expect(page.getByRole('heading', { name: 'Studio', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish site' })).toBeVisible()

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText('Live résumé', { exact: true })).toBeVisible()
  await expect(page.locator('#resume-preview')).toContainText('Brendan Eggers')
  await expect(page.getByRole('button', { name: 'Add role' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add row' })).toHaveCount(2)
})

test('Home serves its Access-protected workspace through the Worker', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:5174/')
  expect(response?.ok()).toBe(true)
  expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
  await expect(page.getByText('Private D1 is ready')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bring in the honeymoon handoff.' })).toBeVisible()
})
