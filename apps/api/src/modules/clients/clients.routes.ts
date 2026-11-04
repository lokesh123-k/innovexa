import { Router } from 'express';
import {
  Role,
  assignClientPartnerSchema,
  createClientSchema,
  idParamSchema,
  inviteClientUserSchema,
  listClientsQuerySchema,
  setClientStatusSchema,
  updateClientSchema,
  type ClientStatus,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { valid, validate } from '../../middleware/validate.js';
import { ok } from '../../utils/http.js';
import { toUserDTO } from '../users/user.serializer.js';
import * as svc from './clients.service.js';

const id = (req: Parameters<typeof valid>[0]) => valid<{ id: string }>(req, 'params').id;

export const clientsRouter = Router();
clientsRouter.use(authenticate);

clientsRouter.get('/me', authorize(Role.CLIENT), async (req, res) => {
  ok(res, await svc.getOwnClient(currentUser(req)));
});
// Read-only for the client: who their Innovexa partner is.
clientsRouter.get('/me/assignment', authorize(Role.CLIENT), async (req, res) => {
  ok(res, await svc.getOwnAssignment(currentUser(req)));
});
// Partner portal: only the clients assigned to the signed-in partner.
clientsRouter.get('/assigned', authorize(Role.PARTNER), async (req, res) => {
  ok(res, await svc.listAssignedClients(currentUser(req)));
});

clientsRouter.use(authorize(Role.ADMIN));
clientsRouter.get('/assignable-partners', async (_req, res) => {
  ok(res, await svc.listAssignablePartners());
});
clientsRouter.get('/', validate({ query: listClientsQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listClients(valid(req, 'query'));
  ok(res, items, 200, meta);
});
clientsRouter.post('/', validate({ body: createClientSchema }), async (req, res) => {
  const client = await svc.createClient(req, valid(req, 'body'));
  ok(res, svc.clientView(client.toObject()), 201);
});
clientsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.getClientDetail(currentUser(req), id(req)));
});
clientsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateClientSchema }),
  async (req, res) => {
    const client = await svc.updateClient(req, id(req), valid(req, 'body'));
    ok(res, svc.clientView(client.toObject()));
  },
);
clientsRouter.patch(
  '/:id/status',
  validate({ params: idParamSchema, body: setClientStatusSchema }),
  async (req, res) => {
    const client = await svc.setClientStatus(
      req,
      id(req),
      valid<{ status: ClientStatus }>(req, 'body').status,
    );
    ok(res, svc.clientView(client.toObject()));
  },
);
clientsRouter.get('/:id/assignment', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.getAssignment(id(req)));
});
// Assign, or change, the client's partner.
clientsRouter.put(
  '/:id/assignment',
  validate({ params: idParamSchema, body: assignClientPartnerSchema }),
  async (req, res) => {
    const { partnerId } = valid<{ partnerId: string }>(req, 'body');
    ok(res, await svc.assignPartner(req, id(req), partnerId));
  },
);
clientsRouter.delete('/:id/assignment', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.removeAssignment(req, id(req)));
});
clientsRouter.post(
  '/:id/logins',
  validate({ params: idParamSchema, body: inviteClientUserSchema }),
  async (req, res) => {
    const user = await svc.inviteClientLogin(req, id(req), valid(req, 'body'));
    ok(res, toUserDTO(user, Role.ADMIN), 201);
  },
);
