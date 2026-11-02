import type { Request, Response } from 'express';
import type {
  InviteUserInput,
  ListUsersQuery,
  SetUserStatusInput,
  UpdateOwnProfileInput,
  UpdateUserInput,
} from '@innovexa/shared';
import { currentUser } from '../../middleware/authenticate.js';
import { valid } from '../../middleware/validate.js';
import { ok } from '../../utils/http.js';
import { toUserDTO } from './user.serializer.js';
import * as users from './users.service.js';

const idParam = (req: Request) => valid<{ id: string }>(req, 'params').id;

export async function list(req: Request, res: Response) {
  const { items, meta } = await users.listUsers(valid<ListUsersQuery>(req, 'query'));
  ok(
    res,
    items.map((u) => toUserDTO(u, currentUser(req).role)),
    200,
    meta,
  );
}

export async function get(req: Request, res: Response) {
  const user = await users.getUser(idParam(req));
  ok(res, toUserDTO(user, currentUser(req).role));
}

export async function invite(req: Request, res: Response) {
  const user = await users.inviteUser(req, valid<InviteUserInput>(req, 'body'));
  ok(res, toUserDTO(user, currentUser(req).role), 201);
}

export async function resendInvite(req: Request, res: Response) {
  const user = await users.resendInvitation(req, idParam(req));
  ok(res, toUserDTO(user, currentUser(req).role));
}

export async function update(req: Request, res: Response) {
  const user = await users.updateUser(req, idParam(req), valid<UpdateUserInput>(req, 'body'));
  ok(res, toUserDTO(user, currentUser(req).role));
}

export async function setStatus(req: Request, res: Response) {
  const user = await users.setUserStatus(req, idParam(req), valid<SetUserStatusInput>(req, 'body'));
  ok(res, toUserDTO(user, currentUser(req).role));
}

export async function updateMe(req: Request, res: Response) {
  const caller = currentUser(req);
  const user = await users.updateOwnProfile(
    req,
    caller._id,
    valid<UpdateOwnProfileInput>(req, 'body'),
  );
  ok(res, toUserDTO(user, caller.role));
}
