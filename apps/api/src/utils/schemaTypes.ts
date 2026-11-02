import { Schema } from 'mongoose';

/** Integer minor-unit money field (e.g. paise). Rejects floats at the persistence layer too. */
export const money = (
  required = true,
  defaultValue: number | undefined = required ? undefined : 0,
) => ({
  type: Number,
  required,
  min: 0,
  default: defaultValue,
  validate: {
    validator: Number.isSafeInteger,
    message: '{PATH} must be an integer amount in minor units',
  },
});

export const ref = (modelName: string, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: modelName,
  required,
});

export const refs = (modelName: string) => ({
  type: [{ type: Schema.Types.ObjectId, ref: modelName }],
  default: [],
});
