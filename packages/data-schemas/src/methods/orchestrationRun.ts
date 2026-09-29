import type { OrchestrationRun } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type {
  IOrchestrationRun,
  LatestOrchestrationRunQuery,
  OrchestrationRunIdentityQuery,
  OrchestrationRunInput,
} from '~/types';
import { serializeOrchestrationRun } from '~/types';

function tenantFilter(tenantId: string | undefined): { tenantId?: string } {
  return tenantId == null ? {} : { tenantId };
}

export function createOrchestrationRunMethods(
  mongoose: typeof import('mongoose'),
): {
  createOrchestrationRun: (run: OrchestrationRunInput) => Promise<OrchestrationRun>;
  getLatestOrchestrationRun: (
    query: LatestOrchestrationRunQuery,
  ) => Promise<OrchestrationRun | null>;
  cancelOrchestrationRun: (
    query: OrchestrationRunIdentityQuery,
  ) => Promise<OrchestrationRun | null>;
} {
  async function createOrchestrationRun(
    run: OrchestrationRunInput,
  ): Promise<OrchestrationRun> {
    const OrchestrationRunModel = mongoose.models.OrchestrationRun as Model<IOrchestrationRun>;
    const createdAt = run.createdAt == null ? new Date() : new Date(run.createdAt);
    const updatedAt = run.updatedAt == null ? createdAt : new Date(run.updatedAt);
    const created = await OrchestrationRunModel.create({
      ...run,
      createdAt,
      updatedAt,
    });
    return serializeOrchestrationRun(created.toObject() as IOrchestrationRun);
  }

  async function getLatestOrchestrationRun({
    conversationId,
    userId,
    tenantId,
  }: LatestOrchestrationRunQuery): Promise<OrchestrationRun | null> {
    const OrchestrationRunModel = mongoose.models.OrchestrationRun as Model<IOrchestrationRun>;
    const run = await OrchestrationRunModel.findOne({
      conversationId,
      userId,
      ...tenantFilter(tenantId),
    })
      .sort({ createdAt: -1 })
      .lean<IOrchestrationRun | null>();
    return run == null ? null : serializeOrchestrationRun(run);
  }

  async function cancelOrchestrationRun({
    runId,
    userId,
    tenantId,
  }: OrchestrationRunIdentityQuery): Promise<OrchestrationRun | null> {
    const OrchestrationRunModel = mongoose.models.OrchestrationRun as Model<IOrchestrationRun>;
    const run = await OrchestrationRunModel.findOneAndUpdate(
      {
        runId,
        userId,
        state: { $in: ['pending', 'running'] },
        ...tenantFilter(tenantId),
      },
      { $set: { state: 'cancelled' } },
      { new: true },
    ).lean<IOrchestrationRun | null>();
    return run == null ? null : serializeOrchestrationRun(run);
  }

  return { createOrchestrationRun, getLatestOrchestrationRun, cancelOrchestrationRun };
}

export type OrchestrationRunMethods = ReturnType<typeof createOrchestrationRunMethods>;
