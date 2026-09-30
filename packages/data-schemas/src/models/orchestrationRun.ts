import { Model } from 'mongoose';
import type { IOrchestrationRun } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import orchestrationRunSchema from '~/schema/orchestrationRun';

export function createOrchestrationRunModel(
  mongoose: typeof import('mongoose'),
): Model<IOrchestrationRun> {
  applyTenantIsolation(orchestrationRunSchema);
  return (
    mongoose.models.OrchestrationRun ||
    mongoose.model<IOrchestrationRun>('OrchestrationRun', orchestrationRunSchema)
  );
}
