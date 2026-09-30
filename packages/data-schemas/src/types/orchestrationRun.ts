import type { OrchestrationRun, OrchestrationRunNode, OrchMode } from 'librechat-data-provider';
import type { Document } from 'mongoose';

export interface IOrchestrationRun extends Document {
  runId: string;
  conversationId: string;
  userId: string;
  tenantId?: string;
  requestedMode: OrchMode;
  resolvedMode: Exclude<OrchMode, 'off'>;
  scheduler: 'manual';
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodes: OrchestrationRunNode[];
  createdAt: Date;
  updatedAt: Date;
}

export type OrchestrationRunInput = Omit<OrchestrationRun, 'createdAt' | 'updatedAt'> & {
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type OrchestrationRunOwnerScope = {
  userId: string;
  tenantId?: string;
};

export type LatestOrchestrationRunQuery = OrchestrationRunOwnerScope & {
  conversationId: string;
};

export type OrchestrationRunIdentityQuery = OrchestrationRunOwnerScope & {
  runId: string;
};

export function serializeOrchestrationRun(run: IOrchestrationRun): OrchestrationRun {
  return {
    runId: run.runId,
    conversationId: run.conversationId,
    userId: run.userId,
    ...(run.tenantId != null && { tenantId: run.tenantId }),
    requestedMode: run.requestedMode,
    resolvedMode: run.resolvedMode,
    scheduler: run.scheduler,
    state: run.state,
    nodes: run.nodes.map((node) => ({
      id: node.id,
      state: node.state,
      ...(node.cls != null && { cls: node.cls }),
      ...(node.dependsOn != null && { dependsOn: node.dependsOn }),
    })),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
