import { expect, test } from 'playwright/test';

const account = { id: 'user-local-owner', email: 'local-owner@roundseo.test', name: 'Local Owner' };

test('requires a password of at least 8 characters before contacting the API', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/v2/auth/**', async route => {
    apiCalls += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByLabel('Work email').fill(account.email);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page.getByRole('alert')).toHaveText('Use a password of at least 8 characters.');
  expect(apiCalls).toBe(0);
});

test('signs in through the API and stores the token the Intelligence panels send', async ({ page }) => {
  await page.route('**/api/v2/auth/login', async route => {
    const body = route.request().postDataJSON() as { email: string; password: string };
    expect(body).toEqual({ email: account.email, password: 'LocalDev-2026-owner' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: account, token: 'test-token-for-sign-in' }) });
  });
  await page.route('**/api/v2/organizations', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ organizations: [] }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByLabel('Work email').fill(account.email);
  await page.getByLabel('Password').fill('LocalDev-2026-owner');
  await page.getByRole('button', { name: 'Sign in' }).last().click();

  await expect(page.getByText('Portfolio', { exact: true }).first()).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('roundseo-token'));
  expect(stored).toBe(JSON.stringify('test-token-for-sign-in'));
});

test('keeps a local session in the browser when the API cannot be reached', async ({ page }) => {
  await page.route('**/api/v2/auth/login', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByLabel('Work email').fill(account.email);
  await page.getByLabel('Password').fill('LocalDev-2026-owner');
  await page.getByRole('button', { name: 'Sign in' }).last().click();

  await expect(page.getByText('Portfolio', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('roundseo-token'))).toBeNull();
  const user = await page.evaluate(() => JSON.parse(localStorage.getItem('roundseo-user') || 'null'));
  expect(user).toMatchObject({ email: account.email });
});
