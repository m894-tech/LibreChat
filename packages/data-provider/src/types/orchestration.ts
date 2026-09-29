export type OrchMode = 'off' | 'auto' | 'team' | 'm2' | 'm3' | 'compare';

export type OrchRunState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type OrchNodeState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type OrchRunScheduler = 'manual';

export type OrchestrationRunNode = {
  id: string;
  state: OrchNodeState;
  cls?: string;
  dependsOn?: string[];
};

export type OrchestrationRun = {
  runId: string;
  conversationId: string;
  userId: string;
  tenantId?: string;
  requestedMode: OrchMode;
  resolvedMode: Exclude<OrchMode, 'off'>;
  scheduler: OrchRunScheduler;
  state: OrchRunState;
  nodes: OrchestrationRunNode[];
  createdAt: string;
  updatedAt: string;
};

export type OrchRunView = Pick<
  OrchestrationRun,
  'runId' | 'conversationId' | 'requestedMode' | 'resolvedMode' | 'scheduler' | 'state' | 'nodes'
> & {
  createdAt?: string;
  updatedAt?: string;
};

export type CreateOrchestrationRunRequest = {
  conversationId: string;
  mode: OrchMode;
};

export type CreateOrchestrationRunResponse = OrchRunView;

export type CancelOrchestrationRunRequest = {
  runId: string;
};

export type CancelOrchestrationRunResponse = OrchRunView;
