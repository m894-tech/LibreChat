import { Model } from 'mongoose';
import type { IAgentOperationalMemoryProfile } from '~/types';
import agentOperationalMemoryProfileSchema from '~/schema/agentOperationalMemoryProfile';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createAgentOperationalMemoryProfileModel(
  mongoose: typeof import('mongoose'),
): Model<IAgentOperationalMemoryProfile> {
  applyTenantIsolation(agentOperationalMemoryProfileSchema);
  return (
    mongoose.models.AgentOperationalMemoryProfile ||
    mongoose.model<IAgentOperationalMemoryProfile>(
      'AgentOperationalMemoryProfile',
      agentOperationalMemoryProfileSchema,
    )
  );
}
