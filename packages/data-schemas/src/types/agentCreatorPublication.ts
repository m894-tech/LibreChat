import type { Document } from 'mongoose';
import type {
  AgentCreatorPublication,
  AgentCreatorPublicationRecordInput,
  AgentCreatorPreview,
  AgentCreatorSpec,
} from 'librechat-data-provider';

export interface IAgentCreatorPublication extends Document {
  publicationId: string;
  agentId: string;
  createdBy: string;
  createdAt: Date;
  source: 'agent_creator';
  specSnapshot: AgentCreatorSpec;
  previewSnapshot: AgentCreatorPreview;
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
  };
}
