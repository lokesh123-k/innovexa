import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Three-portal workflow against the running stack and the configured database.
 * Requires `npm run seed` (demo partner/client) and `npm run seed:admin`.
 * Creates uniquely named "E2E …" records on each run.
 */
const ADMIN = {
  email: process.env.DEV_ADMIN_EMAIL ?? '',
  password: process.env.DEV_ADMIN_PASSWORD ?? '',
};
const PARTNER = { email: 'partner.demo@example.com', password: process.env.SEED_PASSWORD ?? '' };
const CLIENT = { email: 'client.demo@example.com', password: process.env.SEED_PASSWORD ?? '' };
const stamp = Date.now().toString(36).toUpperCase();
const PROJECT = `E2E Project ${stamp}`;
const TASK = `E2E Landing page ${stamp}`;

async function login(
  browser: Browser,
  baseURL: string,
  who: { email: string; password: string },
  home: RegExp,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(home);
  return page;
}

/** Sidebar link by label, tolerating an unread-count badge ("Messages 3"). Labels contain no regex specials. */
const navLink = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: new RegExp(`^${label}( \\d+\\+?)?$`) });

const api = async <T>(
  page: Page,
  method: 'get' | 'post' | 'patch',
  path: string,
  data?: unknown,
): Promise<T> => {
  const res = await page.request[method](`/api/v1${path}`, data ? { data } : undefined);
  expect(
    res.ok(),
    `${method.toUpperCase()} ${path} → ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  return ((await res.json()) as { data: T }).data;
};

test('admin, partner and client portals work end to end', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  test.skip(!ADMIN.password || !PARTNER.password, 'Set DEV_ADMIN_* and SEED_PASSWORD in .env');

  // 1–3. Role-based login lands each user on their own dashboard with their own menu.
  const admin = await login(browser, baseURL!, ADMIN, /\/admin\/dashboard$/);
  for (const label of [
    'Dashboard',
    'Partners',
    'Users & Access',
    'Clients',
    'Projects',
    'Tasks & Assignments',
    'Work Approvals',
    'Messages',
    'Invoices & Payments',
    'Reports & Analytics',
    'Audit Logs',
    'My Profile',
    'Settings',
  ]) {
    await expect(navLink(admin, label)).toBeVisible();
  }
  await expect(admin.getByText('Pending approvals')).toBeVisible();

  const partner = await login(browser, baseURL!, PARTNER, /\/partner\/dashboard$/);
  for (const label of [
    'My Projects',
    'My Tasks',
    'Daily Work Updates',
    'Time Tracking',
    'Work Submission',
    'Reports',
    'Notifications',
  ]) {
    await expect(navLink(partner, label)).toBeVisible();
  }
  const client = await login(browser, baseURL!, CLIENT, /\/client\/dashboard$/);
  for (const label of [
    'Project Timeline',
    'Milestones',
    'Completed Work',
    'Pending Work',
    'Files & Deliverables',
    'Change Requests',
    'Payment History',
  ]) {
    await expect(navLink(client, label)).toBeVisible();
  }

  // 17. Role restrictions are enforced by the API, not just the UI.
  await client.goto('/admin/dashboard');
  await expect(client).toHaveURL(/\/client\/dashboard$/);
  expect((await partner.request.get('/api/v1/invoices')).status()).toBe(403);
  expect((await partner.request.get('/api/v1/clients')).status()).toBe(403);
  expect((await client.request.get('/api/v1/tasks')).status()).toBe(403);
  expect((await client.request.get('/api/v1/dashboard/admin')).status()).toBe(403);

  // 5–7. Admin creates a project for the demo client and assigns a task to the demo partner.
  const [demoClient] = await api<{ id: string }[]>(admin, 'get', '/clients?q=Demo%20Retail');
  const [demoPartner] = await api<{ id: string }[]>(
    admin,
    'get',
    `/users?q=${encodeURIComponent(PARTNER.email)}`,
  );
  const [category] = await api<{ _id: string }[]>(admin, 'get', '/service-categories');
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const project = await api<{ id: string }>(admin, 'post', '/projects', {
    title: PROJECT,
    clientId: demoClient!.id,
    serviceCategoryId: category!._id,
    contractAmountMinor: 5000000,
    startDate: day(-1),
    expectedEndDate: day(45),
    partnerIds: [demoPartner!.id],
    milestones: [
      { title: 'Design approved', dueDate: day(10) },
      { title: 'Launch', dueDate: day(40) },
    ],
  });
  await api(admin, 'post', '/tasks', {
    projectId: project.id,
    title: TASK,
    assigneeIds: [demoPartner!.id],
    dueDate: day(7),
    priority: 'HIGH',
  });
  await admin.goto(`/admin/projects/${project.id}`);
  await expect(admin.getByRole('heading', { name: PROJECT })).toBeVisible();

  // 8–9. Partner updates progress and submits work through the UI.
  await partner.goto('/partner/tasks');
  await partner
    .getByRole('link', { name: new RegExp(TASK) })
    .first()
    .click();
  await expect(partner.getByRole('heading', { name: TASK })).toBeVisible();
  await partner.getByRole('button', { name: '50%', exact: true }).click();
  await partner.getByLabel('Work description').fill('Hero section and navigation built');
  await partner.getByLabel('Time spent (hours)').fill('2');
  await partner.getByRole('button', { name: 'Save update' }).click();
  await expect(partner.getByText('Hero section and navigation built')).toBeVisible();
  await partner.getByRole('tab', { name: 'Submit work' }).click();
  await partner.getByLabel('What are you submitting?').fill('Landing page complete');
  await partner.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(partner.getByText('Your submission is awaiting admin review.')).toBeVisible();
  // Not yet visible to the client.
  const before = await api<{ approvedProgress: number }>(client, 'get', `/projects/${project.id}`);
  expect(before.approvedProgress).toBe(0);

  // 10. Admin approves in Work Approvals.
  await admin.goto('/admin/approvals');
  const card = admin.locator('div.rounded-xl', {
    has: admin.getByRole('link', { name: TASK, exact: true }),
  });
  await card.getByRole('button', { name: 'Review' }).click();
  await admin.getByRole('button', { name: 'Approve work' }).click();
  await expect(admin.getByText('Work approved — project progress updated')).toBeVisible();

  // 11. Client sees approved progress and completed work.
  await client.goto('/client/projects');
  const projectCard = client.getByRole('link', { name: new RegExp(PROJECT) });
  await expect(projectCard).toContainText('100%');
  await projectCard.click();
  await client.getByRole('button', { name: 'Completed work' }).click();
  await expect(client.getByText(TASK)).toBeVisible();

  // 12–13. Client submits a change request; admin responds.
  await client.goto('/client/change-requests');
  await client.getByRole('button', { name: 'New change request' }).click();
  await client.getByLabel('Project').selectOption({ label: PROJECT });
  await client.getByLabel('Title').fill(`Add testimonials ${stamp}`);
  await client
    .getByLabel('What should change?')
    .fill('Please add a customer testimonials carousel to the homepage.');
  await client.getByRole('button', { name: 'Submit request' }).click();
  await expect(client).toHaveURL(/\/client\/change-requests\/[a-f0-9]{24}$/);
  const crId = client.url().split('/').pop()!;
  await admin.goto(`/admin/change-requests/${crId}`);
  await admin.getByLabel('Reply').fill('Happy to add this — estimate is one day.');
  await admin.getByRole('button', { name: 'Send reply' }).click();
  await client.reload();
  await expect(client.getByText('Happy to add this — estimate is one day.')).toBeVisible();

  // 14–16. Invoice with advance + EMI; offline payment updates balances and produces a receipt.
  const invoice = await api<{ id: string; invoiceNumber: string }>(admin, 'post', '/invoices', {
    projectId: project.id,
    invoiceDate: day(0),
    dueDate: day(120),
    contractAmountMinor: 5000000,
    taxMinor: 900000,
    paymentTerms: 'INSTALLMENTS',
    advanceMinor: 900000,
    advanceDueDate: day(3),
    installments: { mode: 'MONTHLY', months: 3, firstDueDate: day(30) },
    issue: true,
  });
  await api(admin, 'post', '/payments/offline', {
    invoiceId: invoice.id,
    amountMinor: 900000,
    method: 'UPI',
    reference: `E2E-${stamp}`,
  });
  await client.goto('/client/invoices');
  await client.getByRole('link', { name: invoice.invoiceNumber }).click();
  await expect(client.getByText('Payment schedule')).toBeVisible();
  await expect(client.getByRole('cell', { name: 'Advance', exact: true })).toBeVisible();
  await expect(client.getByRole('cell', { name: 'Instalment', exact: true })).toHaveCount(3);
  await expect(client.getByText('₹59,000.00').first()).toBeVisible(); // total = 50,000 + 9,000 tax
  await expect(client.getByText('₹50,000.00').first()).toBeVisible(); // remaining balance
  await client.goto('/client/payments');
  await client
    .getByRole('row', { name: new RegExp(invoice.invoiceNumber) })
    .getByRole('link', { name: 'Receipt' })
    .click();
  await expect(client.getByText('Payment receipt')).toBeVisible();
  await expect(client.getByText('₹9,000.00').first()).toBeVisible();

  // Realtime messaging: client → admin and back, without reloading.
  await admin.goto('/admin/messages');
  await client.goto('/client/messages');
  await client.getByRole('button', { name: 'New conversation' }).click();
  const projectSelect = client.getByLabel('About a project (optional)');
  const option = projectSelect.locator('option', { hasText: PROJECT });
  await expect(option).toHaveCount(1);
  await projectSelect.selectOption((await option.getAttribute('value'))!);
  await client.getByRole('button', { name: 'Start conversation' }).click();
  const hello = `Hello from the client ${stamp}`;
  await client.getByLabel('Message').fill(hello);
  await client.getByRole('button', { name: 'Send' }).click();
  await expect(client.getByRole('paragraph').filter({ hasText: hello })).toBeVisible();
  await admin.getByRole('button', { name: new RegExp(`Demo Client.*${PROJECT}`) }).click();
  await expect(admin.getByRole('paragraph').filter({ hasText: hello })).toBeVisible();
  const reply = `Reply from admin ${stamp}`;
  await admin.getByLabel('Message').fill(reply);
  await admin.getByRole('button', { name: 'Send' }).click();
  await expect(client.getByRole('paragraph').filter({ hasText: reply })).toBeVisible({
    timeout: 10_000,
  }); // delivered over Socket.IO, no reload

  // Notifications reached the client.
  await client.goto('/client/notifications');
  await expect(client.getByText(new RegExp(`New invoice ${invoice.invoiceNumber}`))).toBeVisible();
});
