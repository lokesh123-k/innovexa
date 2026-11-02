import { Schema, model, type InferSchemaType } from 'mongoose';
import { FILE_SCOPES, FILE_VISIBILITIES, FileVisibility } from '@innovexa/shared';
import { ref } from '../../utils/schemaTypes.js';

const fileSchema = new Schema(
  {
    ownerId: ref('User', true),
    storage: { type: String, enum: ['local', 'cloudinary', 's3'], required: true },
    /** Provider object key — randomised, never derived from the original filename. */
    key: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    scope: {
      type: new Schema(
        {
          kind: { type: String, enum: FILE_SCOPES, required: true },
          refId: { type: Schema.Types.ObjectId, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    visibility: { type: String, enum: FILE_VISIBILITIES, default: FileVisibility.INTERNAL },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

fileSchema.index({ 'scope.kind': 1, 'scope.refId': 1 });

export type FileAttrs = InferSchemaType<typeof fileSchema>;
export const FileModel = model('File', fileSchema);
