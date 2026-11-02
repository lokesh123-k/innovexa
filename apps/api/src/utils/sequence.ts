import { Schema, model } from 'mongoose';

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model('Counter', counterSchema);

/** Atomically increments and returns the next value of a named sequence. */
export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return doc!.seq;
}

/** e.g. formatCode('PRJ', 7) -> "PRJ-0007"; formatCode('INV-2026', 12) -> "INV-2026-0012". */
export function formatCode(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
