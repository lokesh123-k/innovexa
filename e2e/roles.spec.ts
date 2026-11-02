import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * One login page, three role-based portals. Runs against the running app and
 * the configured database. Requires `npm run seed` and `npm run seed:admin`.
 */
const SEED = process.env.SEED_PASSWORD ?? '';
const ACCOUNTS = {
  ADMIN: {
    email: process.env.DEV_ADMIN_EMAIL ?? '',
    password: process.env.DEV_ADMIN_PASSWORD ?? '',
    home: '/admin/dashboard',
    portal: 'Admin Portal',
  },
  PARTNER: {
    email: 'partner.demo@example.com',
    password: SEED,
    home: '/partner/dashboard',
    portal: 'Partner Portal',
  },
  CLIENT: {
    email: 'client.demo@example.com',
    password: SEED,
    home: '/client/dashboard',
    portal: 'Client Portal',
  },
} as const;
type RoleName = keyof typeof ACCOUNTS;

test.beforeAll(() => {
  if (!ACCOUNTS.ADMIN.password || !SEED)
    throw new Error('Set DEV_ADMIN_* and SEED_PASSWORD in .env');
});

async function fillLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signIn(browser: Browser, baseURL: string, role: RoleName) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const a = ACCOUNTS[role];
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
    fillLogin(page, a.email, a.password),
  ]);
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { data: { user: { role: string } } }).data.user.role).toBe(role);
  await expect(page).toHaveURL(new RegExp(`${a.home}$`));
  return { context, page };
}

const countRefreshes = (page: Page) => {
  const calls: string[] = [];
  page.on('request', (r) => r.url().endsWith('/api/v1/auth/refresh') && calls.push(r.url()));
  return calls;
};

for (const role of Object.keys(ACCOUNTS) as RoleName[]) {
  test(`${role} signs in on the common login page and lands on its own dashboard`, async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await signIn(browser, baseURL!, role);
    await expect(page.getByText(ACCOUNTS[role].portal)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Session persists across a browser refresh and "/" opens the right dashboard.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[role].home}$`));
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[role].home}$`));
    // Signed-in users are bounced away from /login to their portal.
    await page.goto('/login');
    await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[role].home}$`));

    // Other portals redirect to the user's own dashboard.
    for (const other of Object.keys(ACCOUNTS) as RoleName[]) {
      if (other === role) continue;
      await page.goto(ACCOUNTS[other].home);
      await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[role].home}$`));
    }
    await context.close();
  });
}

test('the backend enforces the same portal permissions', async ({ browser, baseURL }) => {
  const partner = await signIn(browser, baseURL!, 'PARTNER');
  const client = await signIn(browser, baseURL!, 'CLIENT');
  const status = async (p: Page, path: string) => (await p.request.get(`/api/v1${path}`)).status();
  for (const path of [
    '/users',
    '/clients',
    '/dashboard/admin',
    '/audit-logs',
    '/reports/financial',
  ]) {
    expect(await status(partner.page, path), `partner ${path}`).toBe(403);
    expect(await status(client.page, path), `client ${path}`).toBe(403);
  }
  expect(await status(partner.page, '/dashboard/client')).toBe(403);
  expect(await status(client.page, '/dashboard/partner')).toBe(403);
  expect(await status(client.page, '/tasks')).toBe(403);
  expect(await status(partner.page, '/invoices')).toBe(403);
  // A role sent from the browser is ignored: the role comes from the database.
  const forged = await partner.page.request.post('/api/v1/auth/login', {
    data: { email: ACCOUNTS.PARTNER.email, password: ACCOUNTS.PARTNER.password, role: 'ADMIN' },
  });
  expect(((await forged.json()) as { data: { user: { role: string } } }).data.user.role).toBe(
    'PARTNER',
  );
  await partner.context.close();
  await client.context.close();
});

test('unauthenticated visitors are sent to /login without a refresh loop', async ({ page }) => {
  const refreshes = countRefreshes(page);
  for (const path of ['/admin/dashboard', '/partner/tasks', '/client/invoices', '/']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.waitForLoadState('networkidle');
  expect(refreshes.length).toBeLessThanOrEqual(4); // at most one attempt per full page load
});

test('wrong password and unknown accounts are rejected with the same message', async ({ page }) => {
  for (const [email, password] of [
    [ACCOUNTS.PARTNER.email, 'Wrong-Password-1'],
    ['nobody-here@example.com', 'Wrong-Password-1'],
  ]) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
      fillLogin(page, email!, password!),
    ]);
    expect(res.status()).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('an inactive account cannot sign in', async ({ browser, baseURL }) => {
  const admin = await signIn(browser, baseURL!, 'ADMIN');
  const [employee] = (
    (await (
      await admin.page.request.get('/api/v1/users?q=employee.demo%40example.com')
    ).json()) as { data: { id: string }[] }
  ).data;
  expect(employee).toBeTruthy();
  const setStatus = (status: string) =>
    admin.page.request.patch(`/api/v1/users/${employee!.id}/status`, { data: { status } });
  try {
    expect((await setStatus('INACTIVE')).status()).toBe(200);
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
      fillLogin(page, 'employee.demo@example.com', SEED),
    ]);
    expect(res.status()).toBe(403);
    await expect(page.getByRole('alert')).toContainText('deactivated');
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  } finally {
    await setStatus('ACTIVE'); // restore the demo account
  }
  await admin.context.close();
});

test('logout clears cookies, invalidates the session and returns to /login', async ({
  browser,
  baseURL,
}) => {
  const { context, page } = await signIn(browser, baseURL!, 'PARTNER');
  const oldRefresh = (await context.cookies()).find((c) => c.name === 'ix_rt')!.value;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).filter((c) => c.name.startsWith('ix_'))).toEqual([]);
  await page.goto('/partner/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  // The old refresh token is dead server-side, not just deleted from the browser.
  const replay = await page.request.post('/api/v1/auth/refresh', {
    headers: { Cookie: `ix_rt=${oldRefresh}` },
  });
  expect(replay.status()).toBe(401);
  await context.close();
});

test('expired access token renews silently; expired session returns to /login', async ({
  browser,
  baseURL,
}) => {
  const { context, page } = await signIn(browser, baseURL!, 'CLIENT');
  const dropCookie = async (ctx: BrowserContext, name: string) => {
    const keep = (await ctx.cookies()).filter((c) => c.name !== name);
    await ctx.clearCookies();
    await ctx.addCookies(keep);
  };

  // Access token expired (cookie gone after 15 min) but refresh session valid → stays signed in.
  await dropCookie(context, 'ix_at');
  const refreshes = countRefreshes(page);
  await page.reload();
  await expect(page).toHaveURL(/\/client\/dashboard$/);
  await expect(page.getByText('Client Portal')).toBeVisible();
  // One per page instance at most: an in-flight request on the old page may also refresh;
  // the server's grace window keeps both tabs/instances signed in.
  expect(refreshes.length).toBeGreaterThanOrEqual(1);
  expect(refreshes.length).toBeLessThanOrEqual(2);
  expect((await context.cookies()).some((c) => c.name === 'ix_at')).toBe(true);

  // Whole session expired → next navigation lands on /login, with no retry loop.
  await page.waitForLoadState('networkidle'); // let phase-1 requests finish before counting
  await context.clearCookies();
  refreshes.length = 0;
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Invoices & Payments/ })
    .click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  expect(refreshes.length).toBeLessThanOrEqual(1);
  await context.close();
});
