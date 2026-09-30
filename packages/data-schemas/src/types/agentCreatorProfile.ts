import type {
  AgentCreatorChildAgentMemory,
  AgentCreatorPreferenceMemory,
  AgentCreatorProfile,
  AgentCreatorProfileInput,
} from 'librechat-data-provider';
import type { Document } from 'mongoose';

export interface IAgentCreatorProfile extends Document {
  creatorAgentId: string;
  createdBy: string;
  tenantId?: string;
  preferences: AgentCreatorPreferenceMemory;
  childAgents: AgentCreatorChildAgentMemory[];
  createdAt: Date;
  updatedAt: Date;
}

export type AgentCreatorProfileRecordInput = AgentCreatorProfileInput;

export function serializeAgentCreatorProfile(profile: IAgentCreatorProfile): AgentCreatorProfile {
  return {
    creatorAgentId: profile.creatorAgentId,
    createdBy: profile.createdBy,
    preferences: profile.preferences ?? {},
    childAgents: (profile.childAgents ?? []).map((child) => ({
      agentId: child.agentId,
      name: child.name,
      publicationId: child.publicationId,
      createdAt:
        child.createdAt instanceof Date ? child.createdAt.toISOString() : String(child.createdAt),
    })),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
