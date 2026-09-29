import { Schema } from 'mongoose';
import type { IAgentCreatorProfile } from '~/types';

const agentCreatorProfileSchema: Schema<IAgentCreatorProfile> = new Schema(
  {
    creatorAgentId: {
      type: String,
      required: true,
      index: true,
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
    preferences: {
      defaultProvider: { type: String, default: undefined },
      defaultModel: { type: String, default: undefined },
      defaultSkillsScope: { type: String, default: undefined },
    },
    childAgents: {
      type: [
        new Schema(
          {
            agentId: { type: String, required: true },
            name: { type: String, required: true },
            publicationId: { type: String, required: true },
            createdAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

agentCreatorProfileSchema.index(
  { creatorAgentId: 1, createdBy: 1, tenantId: 1 },
  { unique: true },
);
agentCreatorProfileSchema.index({ createdBy: 1, updatedAt: -1, tenantId: 1 });

export default agentCreatorProfileSchema;
