import { Schema } from 'mongoose';
import type { IAgentOperationalMemoryProfile } from '~/types';

const agentOperationalMemoryArtifactSchema = new Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    priority: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const agentOperationalMemoryProfileSchema: Schema<IAgentOperationalMemoryProfile> = new Schema(
  {
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
    tenantId: {
      type: String,
      index: true,
    },
    source: {
      type: String,
      required: true,
      default: 'agent_creator',
    },
    role: {
      type: String,
      required: true,
      default: 'general',
    },
    memoryScope: {
      type: String,
      required: true,
      default: 'agent',
    },
    artifacts: {
      type: [agentOperationalMemoryArtifactSchema],
      default: [],
    },
  },
  { timestamps: true },
);

agentOperationalMemoryProfileSchema.index(
  { agentId: 1, createdBy: 1, tenantId: 1 },
  { unique: true },
);
agentOperationalMemoryProfileSchema.index({ createdBy: 1, updatedAt: -1, tenantId: 1 });

export default agentOperationalMemoryProfileSchema;
