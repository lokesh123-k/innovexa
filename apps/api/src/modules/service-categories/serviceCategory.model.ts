import { Schema, model, type InferSchemaType } from 'mongoose';

const serviceCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: String,
    isActive: { type: Boolean, default: true },
    /** Seeded defaults; can be deactivated but not renamed away. */
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type ServiceCategoryAttrs = InferSchemaType<typeof serviceCategorySchema>;
export const ServiceCategory = model('ServiceCategory', serviceCategorySchema);

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
