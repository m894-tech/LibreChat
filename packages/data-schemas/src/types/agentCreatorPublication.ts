import type {
  AgentCreatorPublication,
  AgentCreatorPublicationRecordInput,
  AgentCreatorPreview,
  AgentCreatorSpec,
  AgentOperationalMemoryProfileInput,
} from 'librechat-data-provider';
import type { Document } from 'mongoose';

export interface IAgentCreatorPublication extends Document {
  publicationId: string;
  agentId: string;
  createdBy: string;
  createdAt: Date;
  source: 'agent_creator';
  specSnapshot: AgentCreatorSpec;
  previewSnapshot: AgentCreatorPreview;
  operationalMemorySnapshot?: AgentOperationalMemoryProfileInput;
  tenantId?: string;
}

export type AgentCreatorPublicationInput = AgentCreatorPublicationRecordInput;

export function serializeAgentCreatorPublication(
  publication: IAgentCreatorPublication,
): AgentCreatorPublication {
  return {
    publicationId: publication.publicationId,
    agentId: publication.agentId,
    createdBy: publication.createdBy,
    createdAt: publication.createdAt.toISOString(),
    source: publication.source,
    specSnapshot: publication.specSnapshot,
    previewSnapshot: publication.previewSnapshot,
    ...(publication.operationalMemorySnapshot
      ? { operationalMemorySnapshot: publication.operationalMemorySnapshot }
      : {}),
  };
}
