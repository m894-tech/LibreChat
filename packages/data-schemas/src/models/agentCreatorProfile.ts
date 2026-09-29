import { Model } from 'mongoose';
import type { IAgentCreatorProfile } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agentCreatorProfileSchema from '~/schema/agentCreatorProfile';

export function createAgentCreatorProfileModel(
  mongoose: typeof import('mongoose'),
): Model<IAgentCreatorProfile> {
  applyTenantIsolation(agentCreatorProfileSchema);
  return (
    mongoose.models.AgentCreatorProfile ||
    mongoose.model<IAgentCreatorProfile>('AgentCreatorProfile', agentCreatorProfileSchema)
  );
}
