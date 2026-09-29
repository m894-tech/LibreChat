import { Schema } from 'mongoose';
import type { IAgentCreatorPublication } from '~/types';

const agentCreatorPublicationSchema: Schema<IAgentCreatorPublication> = new Schema(
  {
    publicationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    agentId: {
      type: String,
      required: true,
      index: true,
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      required: true,
    },
    source: {
      type: String,
      enum: ['agent_creator'],
      required: true,
    },
    specSnapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },
    previewSnapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

agentCreatorPublicationSchema.index({ agentId: 1, tenantId: 1 });
agentCreatorPublicationSchema.index({ createdBy: 1, createdAt: -1, tenantId: 1 });

export default agentCreatorPublicationSchema;
