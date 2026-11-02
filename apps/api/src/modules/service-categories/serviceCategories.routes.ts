import { Router } from 'express';
import { z } from 'zod';
import {
  DEFAULT_SERVICE_CATEGORIES,
  Role,
  createServiceCategorySchema,
  idParamSchema,
  updateServiceCategorySchema,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { valid, validate } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { ok } from '../../utils/http.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import { ServiceCategory, slugify } from './serviceCategory.model.js';

/** Idempotently inserts the default categories (startup and seed). */
export async function ensureDefaultCategories(): Promise<void> {
  await Promise.all(
    DEFAULT_SERVICE_CATEGORIES.map((name) =>
      ServiceCategory.updateOne(
        { slug: slugify(name) },
        { $setOnInsert: { name, slug: slugify(name), isSystem: true, isActive: true } },
        { upsert: true },
      ),
    ),
  );
}

export const serviceCategoriesRouter = Router();
serviceCategoriesRouter.use(authenticate);

serviceCategoriesRouter.get(
  '/',
  validate({ query: z.object({ all: z.enum(['true', 'false']).optional() }) }),
  async (req, res) => {
    const all =
      valid<{ all?: string }>(req, 'query').all === 'true' && currentUser(req).role === Role.ADMIN;
    const items = await ServiceCategory.find(all ? {} : { isActive: true })
      .sort({ name: 1 })
      .lean();
    ok(res, items);
  },
);

serviceCategoriesRouter.post(
  '/',
  authorize(Role.ADMIN),
  validate({ body: createServiceCategorySchema }),
  async (req, res) => {
    const body = valid<z.infer<typeof createServiceCategorySchema>>(req, 'body');
    const slug = slugify(body.name);
    if (!slug) throw AppError.badRequest('Enter a valid category name');
    if (await ServiceCategory.exists({ slug }))
      throw AppError.conflict('A category with this name already exists');
    const doc = await ServiceCategory.create({ ...body, slug });
    await recordAudit({
      req,
      action: 'service_category.created',
      entity: 'ServiceCategory',
      entityId: doc._id,
      after: doc,
    });
    ok(res, doc, 201);
  },
);

serviceCategoriesRouter.patch(
  '/:id',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: updateServiceCategorySchema }),
  async (req, res) => {
    const doc = await ServiceCategory.findById(valid<{ id: string }>(req, 'params').id);
    if (!doc) throw AppError.notFound('Category');
    const body = valid<z.infer<typeof updateServiceCategorySchema>>(req, 'body');
    const before = doc.toObject();
    if (body.name && body.name !== doc.name) {
      const slug = slugify(body.name);
      if (await ServiceCategory.exists({ slug, _id: { $ne: doc._id } })) {
        throw AppError.conflict('A category with this name already exists');
      }
      doc.name = body.name;
      doc.slug = slug;
    }
    if (body.description !== undefined) doc.description = body.description;
    if (body.isActive !== undefined) doc.isActive = body.isActive;
    await doc.save();
    await recordAudit({
      req,
      action: 'service_category.updated',
      entity: 'ServiceCategory',
      entityId: doc._id,
      before,
      after: doc,
    });
    ok(res, doc);
  },
);
