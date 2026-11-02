import { Schema, model, type InferSchemaType } from 'mongoose';
import { ref, refs } from '../../utils/schemaTypes.js';

const messageSchema = new Schema(
  {
    conversationId: ref('Conversation', true),
    senderId: ref('User', true),
    body: { type: String, trim: true, maxlength: 5000 },
    attachmentIds: refs('File'),
    readBy: {
      type: [
        new Schema(
          { userId: ref('User', true), at: { type: Date, default: Date.now } },
          { _id: false },
        ),
      ],
      default: [],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, 'readBy.userId': 1 });

export type MessageAttrs = InferSchemaType<typeof messageSchema>;
export const Message = model('Message', messageSchema);
