import { Model } from 'mongoose';
import type { IAgentCreatorPublication } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agentCreatorPublicationSchema from '~/schema/agentCreatorPublication';

export function createAgentCreatorPublicationModel(
  mongoose: typeof import('mongoose'),
): Model<IAgentCreatorPublication> {
  applyTenantIsolation(agentCreatorPublicationSchema);
  return (
    mongoose.models.AgentCreatorPublication ||
    mongoose.model<IAgentCreatorPublication>(
      'AgentCreatorPublication',
      agentCreatorPublicationSchema,
    )
  );
}
