import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { FILE_VISIBILITIES, Role, idParamSchema, objectIdSchema } from '@innovexa/shared';
import { env } from '../../config/env.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { valid, validate } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { ok } from '../../utils/http.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import {
  UPLOADABLE_SCOPES,
  getFileForDownload,
  listFiles,
  publishToClient,
  toFileDTO,
  uploadFile,
} from './files.service.js';

const uploadFields = z.object({
  kind: z.enum(UPLOADABLE_SCOPES),
  refId: objectIdSchema,
  visibility: z.enum(FILE_VISIBILITIES).optional(),
});

export function buildFilesRouter() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
  });
  const router = Router();
  router.use(authenticate);

  router.post(
    '/',
    (req, res, next) =>
      upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          return next(
            err.code === 'LIMIT_FILE_SIZE'
              ? new AppError(
                  413,
                  'FILE_TOO_LARGE',
                  `Files must be ${env().MAX_UPLOAD_MB} MB or smaller`,
                )
              : AppError.badRequest(err.message),
          );
        }
        next(err as Error | undefined);
      }),
    validate({ body: uploadFields }),
    async (req, res) => {
      if (!req.file) throw AppError.badRequest('Choose a file to upload');
      const body = valid<z.infer<typeof uploadFields>>(req, 'body');
      const file = await uploadFile(currentUser(req), { ...body, file: req.file });
      ok(res, toFileDTO(file), 201);
    },
  );

  router.get(
    '/',
    validate({ query: uploadFields.pick({ kind: true, refId: true }) }),
    async (req, res) => {
      const q = valid<{ kind: (typeof UPLOADABLE_SCOPES)[number]; refId: string }>(req, 'query');
      const files = await listFiles(currentUser(req), q.kind, q.refId);
      ok(res, files.map(toFileDTO));
    },
  );

  router.get('/:id/download', validate({ params: idParamSchema }), async (req, res) => {
    const { file, stream } = await getFileForDownload(
      currentUser(req),
      valid<{ id: string }>(req, 'params').id,
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  router.patch(
    '/:id/publish',
    authorize(Role.ADMIN),
    validate({ params: idParamSchema, body: z.object({ published: z.boolean() }) }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const file = await publishToClient(
        currentUser(req),
        id,
        valid<{ published: boolean }>(req, 'body').published,
      );
      await recordAudit({
        req,
        action: 'file.visibility_changed',
        entity: 'File',
        entityId: file._id,
        after: { visibility: file.visibility },
      });
      ok(res, toFileDTO(file));
    },
  );

  return router;
}
