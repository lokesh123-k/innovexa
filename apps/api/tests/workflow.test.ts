/**
 * End-to-end business workflow across all three portals, through the real
 * HTTP API and a real MongoDB: Part 9 scenarios plus isolation checks.
 */
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@innovexa/shared';
import { runReminders } from '../src/jobs/reminders';
import { Notification, Payment, Task } from '../src/models';
import { ensureDefaultCategories } from '../src/modules/service-categories/serviceCategories.routes';
import { API, PASSWORD, app, loginAs, tokenFromMail } from './helpers';

type Agent = ReturnType<typeof request.agent>;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function acceptInvite(email: string): Promise<Agent> {
  const token = tokenFromMail('/accept-invitation', email);
  const agent = request.agent(app);
  await agent.post(`${API}/auth/accept-invitation`).send({ token, password: PASSWORD }).expect(200);
  return agent;
}

function signWebhook(body: string) {
  return createHmac('sha256', 'rzp_test_webhook_secret').update(body).digest('hex');
}

afterEach(() => vi.restoreAllMocks());

describe('three-portal workflow', () => {
  it('runs the full admin → partner → client lifecycle with correct isolation and money', async () => {
    await ensureDefaultCategories();
    const { agent: admin } = await loginAs(Role.ADMIN);

    // 1–5. Admin creates a client, its login, and a partner (invitation flows).
    const client = (
      await admin
        .post(`${API}/clients`)
        .send({
          companyName: 'Sunrise Retail',
          contactName: 'Asha Rao',
          email: 'asha@sunrise.test',
          phone: '+91 98765 43210',
        })
        .expect(201)
    ).body.data;
    expect(client.clientCode).toMatch(/^CLI-\d{4}$/);
    await admin
      .post(`${API}/clients/${client.id}/logins`)
      .send({ name: 'Asha Rao', email: 'asha@sunrise.test' })
      .expect(201);
    const clientAgent = await acceptInvite('asha@sunrise.test');

    const partnerInvite = await admin
      .post(`${API}/users/invite`)
      .send({
        email: 'dev@partner.test',
        name: 'Dev Partner',
        role: 'PARTNER',
        partnerProfile: { partnerType: 'FREELANCER' },
      })
      .expect(201);
    const partner = await acceptInvite('dev@partner.test');
    const partnerId = partnerInvite.body.data.id as string;

    const { agent: otherPartner } = await loginAs(Role.PARTNER);
    const { agent: otherClient } = await loginAs(Role.CLIENT);

    // 6. Admin creates a project with milestones and an allocated partner.
    const categories = (await admin.get(`${API}/service-categories`).expect(200)).body.data;
    expect(categories.length).toBeGreaterThanOrEqual(11);
    const project = (
      await admin
        .post(`${API}/projects`)
        .send({
          title: 'E-commerce Website',
          clientId: client.id,
          serviceCategoryId: categories[0]._id,
          description: 'Storefront build',
          budgetMinor: 8000000,
          contractAmountMinor: 10000000,
          startDate: day(-5),
          expectedEndDate: day(60),
          partnerIds: [partnerId],
          internalNotes: 'Margin is thin',
          milestones: [{ title: 'Design' }, { title: 'Build', dueDate: day(30) }],
        })
        .expect(201)
    ).body.data;
    expect(project.projectCode).toMatch(/^PRJ-\d{4}$/);
    expect(project.milestones).toHaveLength(2);

    // 7. Admin assigns tasks.
    const taskA = (
      await admin
        .post(`${API}/tasks`)
        .send({
          projectId: project.id,
          title: 'Homepage design',
          weight: 3,
          assigneeIds: [partnerId],
          dueDate: day(10),
          priority: 'HIGH',
        })
        .expect(201)
    ).body.data;
    const taskB = (
      await admin
        .post(`${API}/tasks`)
        .send({
          projectId: project.id,
          title: 'Checkout flow',
          weight: 1,
          assigneeIds: [partnerId],
        })
        .expect(201)
    ).body.data;
    expect(taskA.status).toBe('ASSIGNED');

    // Partner sees only their tasks; other partners see nothing.
    expect((await partner.get(`${API}/tasks`).expect(200)).body.data).toHaveLength(2);
    expect((await otherPartner.get(`${API}/tasks`).expect(200)).body.data).toHaveLength(0);
    await otherPartner.get(`${API}/tasks/${taskA.id}`).expect(404);
    await otherPartner.get(`${API}/projects/${project.id}`).expect(404);
    const partnerView = (await partner.get(`${API}/projects/${project.id}`).expect(200)).body.data;
    expect(partnerView.contractAmountMinor).toBeUndefined();
    expect(partnerView.internalNotes).toBeUndefined();

    // 8. Partner uploads a file and updates progress (not yet client-visible).
    const upload = await partner
      .post(`${API}/files`)
      .field('kind', 'TASK')
      .field('refId', taskA.id)
      .attach('file', Buffer.from('%PDF-1.4 mock'), {
        filename: 'homepage.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    await partner
      .post(`${API}/files`)
      .field('kind', 'TASK')
      .field('refId', taskA.id)
      .attach('file', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' })
      .expect(400);
    await otherPartner
      .post(`${API}/files`)
      .field('kind', 'TASK')
      .field('refId', taskA.id)
      .attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(404);
    await partner
      .post(`${API}/tasks/${taskA.id}/updates`)
      .send({
        newProgress: 50,
        description: 'Wireframes done',
        minutesSpent: 120,
        attachmentIds: [upload.body.data.id],
      })
      .expect(201);
    expect(
      (await clientAgent.get(`${API}/projects/${project.id}`).expect(200)).body.data
        .approvedProgress,
    ).toBe(0);
    // The partner can download their file; the client and others cannot.
    await partner.get(upload.body.data.url.replace('/api/v1', API)).expect(200);
    await clientAgent.get(upload.body.data.url.replace('/api/v1', API)).expect(404);

    // 9. Partner submits; partners can never approve.
    await partner
      .post(`${API}/tasks/${taskA.id}/submit`)
      .send({ description: 'Final homepage', newProgress: 100 })
      .expect(201);
    await partner.post(`${API}/tasks/${taskA.id}/review`).send({ decision: 'APPROVE' }).expect(403);
    await partner
      .post(`${API}/tasks/${taskA.id}/updates`)
      .send({ newProgress: 60, description: 'More' })
      .expect(409);

    // 10. Admin approves; weighted progress = (3×100 + 1×0) / 4 = 75.
    const queue = (await admin.get(`${API}/tasks/review-queue`).expect(200)).body.data;
    expect(queue).toHaveLength(1);
    expect(queue[0].submission.description).toBe('Final homepage');
    await admin
      .post(`${API}/tasks/${taskA.id}/review`)
      .send({ decision: 'APPROVE', comment: 'Great work' })
      .expect(200);

    // 11. Client sees approved progress only, without internal data.
    const clientView = (await clientAgent.get(`${API}/projects/${project.id}`).expect(200)).body
      .data;
    expect(clientView.approvedProgress).toBe(75);
    expect(clientView).not.toHaveProperty('budgetMinor');
    expect(clientView).not.toHaveProperty('internalNotes');
    expect(clientView).not.toHaveProperty('partners');
    expect(clientView).not.toHaveProperty('submittedProgress');
    const work = (await clientAgent.get(`${API}/projects/${project.id}/work`).expect(200)).body
      .data;
    expect(work.completed.map((t: { title: string }) => t.title)).toEqual(['Homepage design']);
    expect(work.pending).toHaveLength(1);
    const timeline = (await clientAgent.get(`${API}/projects/${project.id}/timeline`).expect(200))
      .body.data;
    expect(timeline.totals).toMatchObject({ total: 2, completed: 0, pending: 2 });
    await clientAgent.get(`${API}/tasks`).expect(403);
    await otherClient.get(`${API}/projects/${project.id}`).expect(404);
    expect((await otherClient.get(`${API}/projects`).expect(200)).body.data).toHaveLength(0);

    // Revision path keeps approved progress unchanged.
    await partner
      .post(`${API}/tasks/${taskB.id}/submit`)
      .send({ description: 'Checkout v1', newProgress: 100 })
      .expect(201);
    await admin
      .post(`${API}/tasks/${taskB.id}/review`)
      .send({ decision: 'REQUEST_REVISION' })
      .expect(400);
    await admin
      .post(`${API}/tasks/${taskB.id}/review`)
      .send({ decision: 'REQUEST_REVISION', comment: 'Add UPI option' })
      .expect(200);
    const revised = (await partner.get(`${API}/tasks/${taskB.id}`).expect(200)).body.data;
    expect(revised.status).toBe('REVISION_REQUESTED');
    expect(revised.reviewNotes.at(-1).comment).toBe('Add UPI option');
    expect(
      (await clientAgent.get(`${API}/projects/${project.id}`)).body.data.approvedProgress,
    ).toBe(75);

    // Cancelling a task removes it from the denominator.
    await admin.post(`${API}/tasks/${taskB.id}/cancel`).expect(200);
    expect(
      (await clientAgent.get(`${API}/projects/${project.id}`)).body.data.approvedProgress,
    ).toBe(100);
    await admin.post(`${API}/tasks/${taskB.id}/reopen`).expect(200);
    expect(
      (await clientAgent.get(`${API}/projects/${project.id}`)).body.data.approvedProgress,
    ).toBe(75);

    // 12–13. Client change request; admin responds; change order only after approval.
    const cr = (
      await clientAgent
        .post(`${API}/change-requests`)
        .send({
          projectId: project.id,
          title: 'Add wishlist',
          description: 'Customers should be able to save products for later.',
        })
        .expect(201)
    ).body.data;
    await otherClient.get(`${API}/change-requests/${cr.id}`).expect(404);
    await partner.get(`${API}/change-requests`).expect(403);
    await admin
      .patch(`${API}/change-requests/${cr.id}/status`)
      .send({ status: 'UNDER_REVIEW', note: 'Estimating' })
      .expect(200);
    await admin
      .post(`${API}/change-requests/${cr.id}/responses`)
      .send({ body: 'This adds 2 days of work.' })
      .expect(201);
    const crClient = (await clientAgent.get(`${API}/change-requests/${cr.id}`).expect(200)).body
      .data;
    expect(crClient.status).toBe('UNDER_REVIEW');
    expect(crClient.responses.at(-1).body).toBe('This adds 2 days of work.');
    await clientAgent
      .post(`${API}/change-requests/${cr.id}/change-order`)
      .send({ amountMinor: 1, description: 'x' })
      .expect(403);
    await admin
      .post(`${API}/change-requests/${cr.id}/change-order`)
      .send({ amountMinor: 1500000, description: 'Wishlist feature' })
      .expect(200);
    expect((await admin.get(`${API}/projects/${project.id}`)).body.data.contractAmountMinor).toBe(
      11500000,
    );
    const converted = (
      await admin
        .post(`${API}/change-requests/${cr.id}/convert-to-task`)
        .send({ assigneeIds: [partnerId] })
        .expect(200)
    ).body.data;
    expect(converted.status).toBe('CONVERTED_TO_TASK');

    // 14–15. Invoice with advance + 3 monthly instalments.
    const invoice = (
      await admin
        .post(`${API}/invoices`)
        .send({
          projectId: project.id,
          invoiceDate: day(0),
          dueDate: day(120),
          contractAmountMinor: 100000,
          taxMinor: 18000,
          paymentTerms: 'INSTALLMENTS',
          advanceMinor: 18000,
          advanceDueDate: day(2),
          installments: { mode: 'MONTHLY', months: 3, firstDueDate: day(30) },
        })
        .expect(201)
    ).body.data;
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(invoice.totalMinor).toBe(118000);
    expect(invoice.installments.map((i: { amountMinor: number }) => i.amountMinor)).toEqual([
      18000, 33334, 33333, 33333,
    ]);
    // Drafts are invisible to clients until issued.
    expect((await clientAgent.get(`${API}/invoices`).expect(200)).body.data).toHaveLength(0);
    await admin.post(`${API}/invoices/${invoice.id}/issue`).expect(200);
    const clientInvoice = (await clientAgent.get(`${API}/invoices/${invoice.id}`).expect(200)).body
      .data;
    expect(clientInvoice.advanceMinor).toBe(18000);
    expect(clientInvoice.installments).toHaveLength(4);
    await otherClient.get(`${API}/invoices/${invoice.id}`).expect(404);
    await partner.get(`${API}/invoices`).expect(403);

    // 16. Offline payment: covers the advance first, then the first instalment partially.
    await admin
      .post(`${API}/payments/offline`)
      .send({ invoiceId: invoice.id, amountMinor: 999999, method: 'BANK_TRANSFER' })
      .expect(400);
    const pay1 = (
      await admin
        .post(`${API}/payments/offline`)
        .send({
          invoiceId: invoice.id,
          amountMinor: 30000,
          method: 'BANK_TRANSFER',
          reference: 'NEFT123',
        })
        .expect(201)
    ).body.data;
    expect(pay1.isAdvance).toBe(true);
    expect(pay1.receiptNumber).toMatch(/^RCP-\d{4}-\d{4}$/);
    let inv = (await clientAgent.get(`${API}/invoices/${invoice.id}`)).body.data;
    expect(inv).toMatchObject({
      paidMinor: 30000,
      balanceMinor: 88000,
      advancePaidMinor: 18000,
      status: 'PARTIALLY_PAID',
    });
    expect(inv.installments.map((i: { paidMinor: number }) => i.paidMinor)).toEqual([
      18000, 12000, 0, 0,
    ]);
    const receipt = (await clientAgent.get(`${API}/payments/${pay1.id}/receipt`).expect(200)).body
      .data;
    expect(receipt.invoice.invoiceNumber).toBe(invoice.invoiceNumber);
    await otherClient.get(`${API}/payments/${pay1.id}/receipt`).expect(404);

    // Online payment: order → signed webhook, processed exactly once.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'order_TEST1', amount: 21334, currency: 'INR' }), {
        status: 200,
      }),
    );
    const order = (
      await clientAgent.post(`${API}/payments/orders`).send({ invoiceId: invoice.id }).expect(201)
    ).body.data;
    expect(order).toMatchObject({ orderId: 'order_TEST1', amountMinor: 21334 }); // remainder of instalment 1
    const event = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST1', amount: 21334 } } },
    });
    const hook = () =>
      request(app)
        .post(`${API}/payments/webhooks/razorpay`)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signWebhook(event))
        .set('X-Razorpay-Event-Id', 'evt_1')
        .send(event);
    expect((await hook().expect(200)).body.data.duplicate).toBe(false);
    expect((await hook().expect(200)).body.data.duplicate).toBe(true);
    await request(app)
      .post(`${API}/payments/webhooks/razorpay`)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'bad')
      .send(event)
      .expect(400);
    // A different event for the same payment must not double count either.
    const event2 = event.replace('payment.captured', 'order.paid');
    await request(app)
      .post(`${API}/payments/webhooks/razorpay`)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signWebhook(event2))
      .set('X-Razorpay-Event-Id', 'evt_2')
      .send(event2)
      .expect(200);
    inv = (await clientAgent.get(`${API}/invoices/${invoice.id}`)).body.data;
    expect(inv).toMatchObject({ paidMinor: 51334, balanceMinor: 66666 });
    expect(inv.installments.map((i: { status: string }) => i.status)).toEqual([
      'PAID',
      'PAID',
      'PENDING',
      'PENDING',
    ]);
    expect(await Payment.countDocuments({ status: 'SUCCEEDED' })).toBe(2);
    const history = (await clientAgent.get(`${API}/payments`).expect(200)).body.data;
    expect(history).toHaveLength(2);

    // Messaging: client ↔ admin, private from partners.
    const conv = (
      await clientAgent.post(`${API}/conversations`).send({ projectId: project.id }).expect(201)
    ).body.data;
    await clientAgent
      .post(`${API}/conversations/${conv.id}/messages`)
      .send({ body: 'When is the next demo?' })
      .expect(201);
    const adminConvs = (await admin.get(`${API}/conversations`).expect(200)).body.data;
    expect(adminConvs.find((c: { id: string }) => c.id === conv.id).unread).toBe(1);
    await admin.post(`${API}/conversations/${conv.id}/read`).expect(200);
    await admin
      .post(`${API}/conversations/${conv.id}/messages`)
      .send({ body: 'Friday at 4pm.' })
      .expect(201);
    await partner.get(`${API}/conversations/${conv.id}/messages`).expect(404);
    await otherClient
      .post(`${API}/conversations/${conv.id}/messages`)
      .send({ body: 'hi' })
      .expect(404);
    expect((await clientAgent.get(`${API}/conversations/unread-count`)).body.data.unread).toBe(1);
    const msgs = (await clientAgent.get(`${API}/conversations/${conv.id}/messages`).expect(200))
      .body.data;
    expect(msgs.map((m: { body: string }) => m.body)).toEqual([
      'When is the next demo?',
      'Friday at 4pm.',
    ]);

    // Notifications reached the right people.
    expect(
      await Notification.countDocuments({ type: 'TASK_ASSIGNED', recipientId: partnerId }),
    ).toBeGreaterThanOrEqual(2);
    const clientNotes = (await clientAgent.get(`${API}/notifications`).expect(200)).body;
    expect(clientNotes.data.map((n: { type: string }) => n.type)).toEqual(
      expect.arrayContaining(['INVOICE_CREATED', 'PAYMENT_RECEIVED', 'NEW_MESSAGE']),
    );
    await clientAgent.post(`${API}/notifications/read-all`).expect(200);
    expect((await clientAgent.get(`${API}/notifications`)).body.meta.unread).toBe(0);

    // Partner daily report and time tracking.
    await partner
      .post(`${API}/work-reports`)
      .send({
        type: 'DAILY',
        date: day(0),
        workCompleted: 'Homepage polish',
        minutesWorked: 300,
        taskIds: [taskA.id],
      })
      .expect(201);
    await partner
      .post(`${API}/work-reports`)
      .send({ type: 'DAILY', date: day(0), workCompleted: 'Again', minutesWorked: 10 })
      .expect(409);
    await otherPartner
      .post(`${API}/work-reports`)
      .send({
        type: 'DAILY',
        date: day(0),
        workCompleted: 'Sneaky',
        minutesWorked: 10,
        taskIds: [taskA.id],
      })
      .expect(400);
    expect(
      (await admin.get(`${API}/work-reports`).query({ partnerId }).expect(200)).body.data,
    ).toHaveLength(1);
    expect((await otherPartner.get(`${API}/work-reports`).expect(200)).body.data).toHaveLength(0);
    const time = (
      await partner
        .get(`${API}/work-reports/time/summary`)
        .query({ from: day(-1), to: day(1) })
        .expect(200)
    ).body.data;
    expect(time.byTask[0].minutes).toBe(120);

    // Dashboards reflect the same records; roles cannot cross over.
    const adminDash = (await admin.get(`${API}/dashboard/admin`).expect(200)).body.data;
    expect(adminDash.tasks.awaitingReview).toBe(0);
    expect(adminDash.billing).toMatchObject({
      invoicedMinor: 118000,
      receivedMinor: 51334,
      outstandingMinor: 66666,
    });
    const partnerDash = (await partner.get(`${API}/dashboard/partner`).expect(200)).body.data;
    expect(partnerDash.tasks).toMatchObject({ total: 3, done: 1 });
    const clientDash = (await clientAgent.get(`${API}/dashboard/client`).expect(200)).body.data;
    expect(clientDash.billing).toMatchObject({ advancePaidMinor: 18000, outstandingMinor: 66666 });
    await partner.get(`${API}/dashboard/admin`).expect(403);
    await clientAgent.get(`${API}/dashboard/partner`).expect(403);
    await partner.get(`${API}/reports/financial`).expect(403);

    // Reports: totals reconcile with the records; CSV export works.
    const fin = (await admin.get(`${API}/reports/financial`).expect(200)).body.data;
    expect(fin.totals).toMatchObject({ total: 118000, received: 51334, balance: 66666 });
    const csv = await admin.get(`${API}/reports/financial`).query({ format: 'csv' }).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(invoice.invoiceNumber);
    expect(csv.text).toContain('1180.00');

    // Partner overview for the admin Partners page.
    const overview = (await admin.get(`${API}/dashboard/partners/${partnerId}`).expect(200)).body
      .data;
    expect(overview.projects).toHaveLength(1);
    expect(overview.time.totalMinutes).toBe(120);
  });

  it('deactivating a client blocks its portal logins', async () => {
    const { agent: admin } = await loginAs(Role.ADMIN);
    const { agent: clientAgent, user } = await loginAs(Role.CLIENT);
    await admin
      .patch(`${API}/clients/${user.clientId!.toString()}/status`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    await clientAgent.get(`${API}/auth/me`).expect(401);
    await admin
      .patch(`${API}/clients/${user.clientId!.toString()}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
  });

  it('sends deadline reminders exactly once', async () => {
    const { agent: admin } = await loginAs(Role.ADMIN);
    const { user: partnerUser } = await loginAs(Role.PARTNER);
    const { user: clientUser } = await loginAs(Role.CLIENT);
    await ensureDefaultCategories();
    const cat = (await admin.get(`${API}/service-categories`)).body.data[0]._id;
    const project = (
      await admin
        .post(`${API}/projects`)
        .send({
          title: 'Reminder Project',
          clientId: clientUser.clientId!.toString(),
          serviceCategoryId: cat,
          contractAmountMinor: 1000,
          startDate: day(-1),
          expectedEndDate: day(10),
        })
        .expect(201)
    ).body.data;
    await admin
      .post(`${API}/tasks`)
      .send({
        projectId: project.id,
        title: 'Due tomorrow',
        assigneeIds: [partnerUser.id],
        dueDate: day(0.5),
      })
      .expect(201);
    expect(await runReminders()).toBe(1);
    expect(await runReminders()).toBe(0);
    expect(
      await Notification.countDocuments({
        type: 'TASK_DEADLINE_APPROACHING',
        recipientId: partnerUser._id,
      }),
    ).toBe(1);
    await Task.updateMany({}, { $set: { dueDate: new Date(Date.now() - 3_600_000) } });
    expect(await runReminders()).toBe(1);
  });
});
