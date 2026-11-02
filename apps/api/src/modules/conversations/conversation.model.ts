import { Schema, model, type InferSchemaType } from 'mongoose';
import { CONVERSATION_TYPES, ConversationType, Role } from '@innovexa/shared';
import { ref, refs } from '../../utils/schemaTypes';

const conversationSchema = new Schema(
  {
    type: { type: String, enum: CONVERSATION_TYPES, default: ConversationType.DIRECT },
    /** The partner or client this thread is with; any admin may read and reply. */
    userId: ref('User', true),
    participantIds: refs('User'),
    projectId: ref('Project'),
    /** Which non-admin role takes part; enforces admin↔partner and admin↔client separation. */
    audience: { type: String, enum: [Role.PARTNER, Role.CLIENT], required: true },
    title: String,
    lastMessageAt: Date,
    lastMessagePreview: String,
    createdBy: ref('User'),
  },
  { timestamps: true },
);

conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
conversationSchema.index({ projectId: 1, audience: 1 });
conversationSchema.index({ userId: 1, projectId: 1 });

export type ConversationAttrs = InferSchemaType<typeof conversationSchema>;
export const Conversation = model('Conversation', conversationSchema);
