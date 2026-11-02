import { Router } from 'express';
import {
  Role,
  createClientSchema,
  idParamSchema,
  inviteClientUserSchema,
  listClientsQuerySchema,
  setClientStatusSchema,
  updateClientSchema,
  type ClientStatus,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import { ok } from '../../utils/http';
import { toUserDTO } from '../users/user.serializer';
import * as svc from './clients.service';

const id = (req: Parameters<typeof valid>[0]) => valid<{ id: string }>(req, 'params').id;

export const clientsRouter = Router();
clientsRouter.use(authenticate);

clientsRouter.get('/me', authorize(Role.CLIENT), async (req, res) => {
  ok(res, await svc.getOwnClient(currentUser(req)));
});

clientsRouter.use(authorize(Role.ADMIN));
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
clientsRouter.post(
  '/:id/logins',
  validate({ params: idParamSchema, body: inviteClientUserSchema }),
  async (req, res) => {
    const user = await svc.inviteClientLogin(req, id(req), valid(req, 'body'));
    ok(res, toUserDTO(user, Role.ADMIN), 201);
  },
);
