import { expect, test } from '@playwright/test';

const email = process.env.DEV_ADMIN_EMAIL ?? '';
const password = process.env.DEV_ADMIN_PASSWORD ?? '';

test.beforeAll(() => {
  if (!email || !password) throw new Error('Set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD in .env');
});

test('wrong password shows a clear error and stays on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(`${password}-wrong`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
  await expect(page).toHaveURL(/\/login$/);
});

test('admin signs in, lands on the dashboard, keeps the session and signs out', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const calls: string[] = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/')) calls.push(`${r.request().method()} ${path} ${r.status()}`);
  });

  // Signed-out cold load: one /me 401 and at most one refresh attempt, no loop.
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  expect(calls.filter((c) => c.includes('/auth/refresh')).length).toBeLessThanOrEqual(1);
  calls.length = 0;

  await page.getByLabel('Email').fill(`  ${email.toUpperCase()} `);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  expect(response.status()).toBe(200);

  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  await expect(page.getByText('Admin Portal')).toBeVisible();

  // Tokens live in httpOnly cookies, never in JS-readable storage.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'ix_at')?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === 'ix_rt')?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('ix_');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/ix_|token/i);

  // Session survives a reload, and the cookie authenticates /auth/me.
  const [me] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/me')),
    page.reload(),
  ]);
  expect(me.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

  // Admin-only page loads real data.
  await page.getByRole('link', { name: 'Users & access' }).click();
  await expect(page.getByRole('cell', { name: new RegExp(email, 'i') })).toBeVisible();

  // Sign out ends the session; admin pages redirect to login.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.context().cookies()).filter((c) => c.name.startsWith('ix_'))).toEqual([]);
  const denied = await page.request.get('/api/v1/users');
  expect(denied.status()).toBe(401);

  expect(pageErrors).toEqual([]);
});

test('a password with an accidental outer space is caught before sending', async ({ page }) => {
  let loginRequests = 0;
  page.on('request', (r) => r.url().endsWith('/api/v1/auth/login') && loginRequests++);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(`${password} `);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/starts or ends with a space/)).toBeVisible();
  expect(loginRequests).toBe(0);
});

test('a locked account shows the expiry and how to recover', async ({ page }) => {
  // UI-only check: the 423 response shape comes from the API tests.
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 423,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed attempts. Try again in 15 minutes or reset your password.',
          details: { lockedUntil: new Date(Date.now() + 15 * 60_000).toISOString() },
        },
      }),
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Try again in 15 minutes/)).toBeVisible();
  await expect(page.getByText(/Locked until/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'reset your password' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
});
