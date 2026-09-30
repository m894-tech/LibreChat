import type {
  AgentOperationalMemoryProfile,
  AgentOperationalMemoryProfileInput,
} from 'librechat-data-provider';
import type { Document } from 'mongoose';

export interface IAgentOperationalMemoryProfile extends Document {
  agentId: string;
  createdBy: string;
  tenantId?: string;
  source: 'agent_creator';
  role: AgentOperationalMemoryProfile['role'];
  memoryScope: AgentOperationalMemoryProfile['memoryScope'];
  artifacts: AgentOperationalMemoryProfile['artifacts'];
  createdAt: Date;
  updatedAt: Date;
}

export type AgentOperationalMemoryProfileRecordInput = AgentOperationalMemoryProfileInput;

export function serializeAgentOperationalMemoryProfile(
  profile: IAgentOperationalMemoryProfile,
): AgentOperationalMemoryProfile {
  return {
    agentId: profile.agentId,
    createdBy: profile.createdBy,
    ...(profile.tenantId ? { tenantId: profile.tenantId } : {}),
    source: profile.source,
    role: profile.role,
    memoryScope: profile.memoryScope,
    artifacts: (profile.artifacts ?? []).map((artifact) => ({
      key: artifact.key,
      title: artifact.title,
      content: artifact.content,
      priority: artifact.priority,
    })),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
