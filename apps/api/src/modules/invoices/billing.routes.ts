import express, { Router } from 'express';
import {
  Role,
  createInvoiceSchema,
  createPaymentOrderSchema,
  idParamSchema,
  listInvoicesQuerySchema,
  listPaymentsQuerySchema,
  recordOfflinePaymentSchema,
  verifyPaymentSchema,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import { ok } from '../../utils/http';
import * as svc from './billing.service';

const id = (req: Parameters<typeof valid>[0]) => valid<{ id: string }>(req, 'params').id;

export const invoicesRouter = Router();
invoicesRouter.use(authenticate, authorize(Role.ADMIN, Role.CLIENT));

invoicesRouter.get('/', validate({ query: listInvoicesQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listInvoices(currentUser(req), valid(req, 'query'));
  ok(res, items, 200, meta);
});
invoicesRouter.post(
  '/',
  authorize(Role.ADMIN),
  validate({ body: createInvoiceSchema }),
  async (req, res) => {
    const invoice = await svc.createInvoice(req, valid(req, 'body'));
    ok(res, await svc.getInvoice(currentUser(req), invoice._id.toString()), 201);
  },
);
invoicesRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.getInvoice(currentUser(req), id(req)));
});
invoicesRouter.post(
  '/:id/issue',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await svc.issueInvoice(req, id(req));
    ok(res, await svc.getInvoice(currentUser(req), id(req)));
  },
);
invoicesRouter.post(
  '/:id/cancel',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await svc.cancelInvoice(req, id(req));
    ok(res, await svc.getInvoice(currentUser(req), id(req)));
  },
);

export const paymentsRouter = Router();
paymentsRouter.use(authenticate, authorize(Role.ADMIN, Role.CLIENT));

paymentsRouter.get('/config', (_req, res) => {
  ok(res, svc.gatewayConfig());
});
paymentsRouter.get('/', validate({ query: listPaymentsQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listPayments(currentUser(req), valid(req, 'query'));
  ok(res, items, 200, meta);
});
paymentsRouter.post(
  '/offline',
  authorize(Role.ADMIN),
  validate({ body: recordOfflinePaymentSchema }),
  async (req, res) => {
    const payment = await svc.recordOfflinePayment(req, valid(req, 'body'));
    ok(res, svc.paymentView(payment.toObject()), 201);
  },
);
paymentsRouter.post(
  '/orders',
  authorize(Role.CLIENT),
  validate({ body: createPaymentOrderSchema }),
  async (req, res) => {
    ok(res, await svc.createGatewayOrder(currentUser(req), valid(req, 'body')), 201);
  },
);
paymentsRouter.post(
  '/verify',
  authorize(Role.CLIENT),
  validate({ body: verifyPaymentSchema }),
  async (req, res) => {
    ok(res, await svc.verifyCheckout(currentUser(req), valid(req, 'body')));
  },
);
paymentsRouter.get('/:id/receipt', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.getReceipt(currentUser(req), id(req)));
});

/** Mounted before the JSON parser: the signature is computed over the raw body. */
export const paymentWebhookRouter = Router();
paymentWebhookRouter.post(
  '/razorpay',
  express.raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    const result = await svc.handleRazorpayWebhook(
      req.body as Buffer,
      req.get('x-razorpay-signature'),
      req.get('x-razorpay-event-id'),
    );
    ok(res, result);
  },
);
