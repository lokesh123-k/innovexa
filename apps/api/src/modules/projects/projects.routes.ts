import { Router } from 'express';
import {
  Role,
  createMilestoneSchema,
  createProjectSchema,
  idParamSchema,
  listProjectsQuerySchema,
  updateMilestoneSchema,
  updateProjectSchema,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import { ok } from '../../utils/http';
import * as svc from './projects.service';

const id = (req: Parameters<typeof valid>[0]) => valid<{ id: string }>(req, 'params').id;

export const projectsRouter = Router();
projectsRouter.use(authenticate);

projectsRouter.get('/', validate({ query: listProjectsQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listProjects(
    currentUser(req),
    valid<ListProjectsQuery>(req, 'query'),
  );
  ok(res, items, 200, meta);
});
projectsRouter.post(
  '/',
  authorize(Role.ADMIN),
  validate({ body: createProjectSchema }),
  async (req, res) => {
    const project = await svc.createProject(req, valid<CreateProjectInput>(req, 'body'));
    ok(res, await svc.getProject(currentUser(req), project._id.toString()), 201);
  },
);
projectsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.getProject(currentUser(req), id(req)));
});
projectsRouter.patch(
  '/:id',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: updateProjectSchema }),
  async (req, res) => {
    await svc.updateProject(req, id(req), valid<UpdateProjectInput>(req, 'body'));
    ok(res, await svc.getProject(currentUser(req), id(req)));
  },
);
projectsRouter.get('/:id/timeline', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.projectTimeline(currentUser(req), id(req)));
});
projectsRouter.get(
  '/:id/work',
  authorize(Role.ADMIN, Role.CLIENT),
  validate({ params: idParamSchema }),
  async (req, res) => {
    ok(res, await svc.projectWork(currentUser(req), id(req)));
  },
);
projectsRouter.get('/:id/milestones', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await svc.listMilestones(currentUser(req), id(req)));
});
projectsRouter.post(
  '/:id/milestones',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: createMilestoneSchema }),
  async (req, res) => {
    ok(res, await svc.createMilestone(req, id(req), valid<CreateMilestoneInput>(req, 'body')), 201);
  },
);

export const milestonesRouter = Router();
milestonesRouter.use(authenticate, authorize(Role.ADMIN));
milestonesRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateMilestoneSchema }),
  async (req, res) => {
    ok(res, await svc.updateMilestone(req, id(req), valid<UpdateMilestoneInput>(req, 'body')));
  },
);
milestonesRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  await svc.deleteMilestone(req, id(req));
  ok(res, { deleted: true });
});
