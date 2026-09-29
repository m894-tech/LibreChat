import type { Model } from 'mongoose';
import type { AgentCreatorPublication } from 'librechat-data-provider';
import type { AgentCreatorPublicationInput, IAgentCreatorPublication } from '~/types';
import { serializeAgentCreatorPublication } from '~/types';

export function createAgentCreatorPublicationMethods(
  mongoose: typeof import('mongoose'),
): {
  recordAgentCreatorPublication: (
    publication: AgentCreatorPublicationInput,
  ) => Promise<AgentCreatorPublication>;
  getAgentCreatorPublicationByAgentId: (agentId: string) => Promise<AgentCreatorPublication | null>;
} {
  async function recordAgentCreatorPublication(
    publication: AgentCreatorPublicationInput,
  ): Promise<AgentCreatorPublication> {
    const AgentCreatorPublicationModel = mongoose.models
      .AgentCreatorPublication as Model<IAgentCreatorPublication>;
    const createdAt = publication.createdAt == null ? new Date() : new Date(publication.createdAt);
    const created = await AgentCreatorPublicationModel.create({
      ...publication,
      createdAt,
      source: publication.source ?? 'agent_creator',
    });
    return serializeAgentCreatorPublication(created.toObject() as IAgentCreatorPublication);
  }

  async function getAgentCreatorPublicationByAgentId(
    agentId: string,
  ): Promise<AgentCreatorPublication | null> {
    const AgentCreatorPublicationModel = mongoose.models
      .AgentCreatorPublication as Model<IAgentCreatorPublication>;
    const publication = await AgentCreatorPublicationModel.findOne({ agentId })
      .sort({ createdAt: -1 })
      .lean<IAgentCreatorPublication | null>();
    return publication == null ? null : serializeAgentCreatorPublication(publication);
  }

  return { recordAgentCreatorPublication, getAgentCreatorPublicationByAgentId };
}

export type AgentCreatorPublicationMethods = ReturnType<
  typeof createAgentCreatorPublicationMethods
>;
