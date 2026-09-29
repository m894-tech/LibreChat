import { Schema } from 'mongoose';
import type { IOrchestrationRun } from '~/types';

const orchestrationRunNodeSchema = new Schema(
  {
    id: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
      required: true,
    },
    cls: {
      type: String,
    },
    dependsOn: {
      type: [String],
      default: undefined,
    },
  },
  { _id: false },
);

const orchestrationRunSchema: Schema<IOrchestrationRun> = new Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
    requestedMode: {
      type: String,
      enum: ['auto', 'team', 'm2', 'm3', 'compare'],
      required: true,
    },
    resolvedMode: {
      type: String,
      enum: ['auto', 'team', 'm2', 'm3', 'compare'],
      required: true,
    },
    scheduler: {
      type: String,
      enum: ['manual'],
      required: true,
    },
    state: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      required: true,
    },
    nodes: {
      type: [orchestrationRunNodeSchema],
      required: true,
      default: undefined,
    },
  },
  { timestamps: true },
);

orchestrationRunSchema.index({ conversationId: 1, userId: 1, tenantId: 1, createdAt: -1 });
orchestrationRunSchema.index({ userId: 1, tenantId: 1, createdAt: -1 });

export default orchestrationRunSchema;
