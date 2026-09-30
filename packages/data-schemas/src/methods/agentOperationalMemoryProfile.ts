import type { AgentOperationalMemoryProfile } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type {
  AgentOperationalMemoryProfileRecordInput,
  IAgentOperationalMemoryProfile,
} from '~/types';
import { serializeAgentOperationalMemoryProfile } from '~/types';

const hasTenantId = (tenantId: string | undefined): tenantId is string =>
  tenantId != null && tenantId !== '';

const createTenantFilter = (tenantId: string | undefined) =>
  hasTenantId(tenantId) ? { tenantId } : { tenantId: { $exists: false } };

export function createAgentOperationalMemoryProfileMethods(mongoose: typeof import('mongoose')): {
  upsertAgentOperationalMemoryProfile: (
    profile: AgentOperationalMemoryProfileRecordInput,
  ) => Promise<AgentOperationalMemoryProfile>;
  getAgentOperationalMemoryProfile: (params: {
    agentId: string;
    createdBy: string;
    tenantId?: string;
  }) => Promise<AgentOperationalMemoryProfile | null>;
  updateAgentOperationalMemoryProfile: (params: {
    agentId: string;
    createdBy: string;
    tenantId?: string;
    artifacts: AgentOperationalMemoryProfile['artifacts'];
    role?: AgentOperationalMemoryProfile['role'];
    memoryScope?: AgentOperationalMemoryProfile['memoryScope'];
  }) => Promise<AgentOperationalMemoryProfile | null>;
  deleteAgentOperationalMemoryProfile: (params: {
    agentId: string;
    createdBy?: string;
    tenantId?: string;
  }) => Promise<{ deletedCount: number }>;
} {
  async function upsertAgentOperationalMemoryProfile(
    profile: AgentOperationalMemoryProfileRecordInput,
  ): Promise<AgentOperationalMemoryProfile> {
    const AgentOperationalMemoryProfileModel = mongoose.models
      .AgentOperationalMemoryProfile as Model<IAgentOperationalMemoryProfile>;
    const updated = await AgentOperationalMemoryProfileModel.findOneAndUpdate(
      {
        agentId: profile.agentId,
        createdBy: profile.createdBy,
        ...createTenantFilter(profile.tenantId),
      },
      {
        $set: {
          source: profile.source ?? 'agent_creator',
          role: profile.role,
          memoryScope: profile.memoryScope,
          artifacts: profile.artifacts,
          ...(hasTenantId(profile.tenantId) ? { tenantId: profile.tenantId } : {}),
        },
        $setOnInsert: {
          agentId: profile.agentId,
          createdBy: profile.createdBy,
        },
      },
      { upsert: true, new: true },
    ).lean<IAgentOperationalMemoryProfile>();

    return serializeAgentOperationalMemoryProfile(updated);
  }

  async function getAgentOperationalMemoryProfile(params: {
    agentId: string;
    createdBy: string;
    tenantId?: string;
  }): Promise<AgentOperationalMemoryProfile | null> {
    const AgentOperationalMemoryProfileModel = mongoose.models
      .AgentOperationalMemoryProfile as Model<IAgentOperationalMemoryProfile>;
    const profile = await AgentOperationalMemoryProfileModel.findOne({
      agentId: params.agentId,
      createdBy: params.createdBy,
      ...createTenantFilter(params.tenantId),
    }).lean<IAgentOperationalMemoryProfile | null>();
    return profile == null ? null : serializeAgentOperationalMemoryProfile(profile);
  }

  async function updateAgentOperationalMemoryProfile(params: {
    agentId: string;
    createdBy: string;
    tenantId?: string;
    artifacts: AgentOperationalMemoryProfile['artifacts'];
    role?: AgentOperationalMemoryProfile['role'];
    memoryScope?: AgentOperationalMemoryProfile['memoryScope'];
  }): Promise<AgentOperationalMemoryProfile | null> {
    const AgentOperationalMemoryProfileModel = mongoose.models
      .AgentOperationalMemoryProfile as Model<IAgentOperationalMemoryProfile>;
    const updated = await AgentOperationalMemoryProfileModel.findOneAndUpdate(
      {
        agentId: params.agentId,
        createdBy: params.createdBy,
        ...createTenantFilter(params.tenantId),
      },
      {
        $set: {
          artifacts: params.artifacts,
          ...(params.role ? { role: params.role } : {}),
          ...(params.memoryScope ? { memoryScope: params.memoryScope } : {}),
        },
      },
      { new: true },
    ).lean<IAgentOperationalMemoryProfile | null>();
    return updated == null ? null : serializeAgentOperationalMemoryProfile(updated);
  }

  async function deleteAgentOperationalMemoryProfile(params: {
    agentId: string;
    createdBy?: string;
    tenantId?: string;
  }): Promise<{ deletedCount: number }> {
    const AgentOperationalMemoryProfileModel = mongoose.models
      .AgentOperationalMemoryProfile as Model<IAgentOperationalMemoryProfile>;
    const result = await AgentOperationalMemoryProfileModel.deleteOne({
      agentId: params.agentId,
      ...(params.createdBy ? { createdBy: params.createdBy } : {}),
      ...createTenantFilter(params.tenantId),
    });
    return { deletedCount: result.deletedCount ?? 0 };
  }

  return {
    upsertAgentOperationalMemoryProfile,
    getAgentOperationalMemoryProfile,
    updateAgentOperationalMemoryProfile,
    deleteAgentOperationalMemoryProfile,
  };
}

export type AgentOperationalMemoryProfileMethods = ReturnType<
  typeof createAgentOperationalMemoryProfileMethods
>;
