import type { AgentCreatorChildAgentMemory, AgentCreatorProfile } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { AgentCreatorProfileRecordInput, IAgentCreatorProfile } from '~/types';
import { serializeAgentCreatorProfile } from '~/types';

export function createAgentCreatorProfileMethods(mongoose: typeof import('mongoose')): {
  upsertAgentCreatorProfile: (
    profile: AgentCreatorProfileRecordInput,
  ) => Promise<AgentCreatorProfile>;
  rememberAgentCreatorChild: (params: {
    creatorAgentId: string;
    createdBy: string;
    tenantId?: string;
    child: AgentCreatorChildAgentMemory;
  }) => Promise<AgentCreatorProfile>;
  getAgentCreatorProfile: (params: {
    creatorAgentId: string;
    createdBy: string;
    tenantId?: string;
  }) => Promise<AgentCreatorProfile | null>;
} {
  async function upsertAgentCreatorProfile(
    profile: AgentCreatorProfileRecordInput,
  ): Promise<AgentCreatorProfile> {
    const AgentCreatorProfileModel = mongoose.models
      .AgentCreatorProfile as Model<IAgentCreatorProfile>;
    const updated = await AgentCreatorProfileModel.findOneAndUpdate(
      {
        creatorAgentId: profile.creatorAgentId,
        createdBy: profile.createdBy,
        ...(profile.tenantId ? { tenantId: profile.tenantId } : {}),
      },
      {
        $set: {
          preferences: profile.preferences ?? {},
          ...(profile.tenantId ? { tenantId: profile.tenantId } : {}),
        },
        $setOnInsert: {
          creatorAgentId: profile.creatorAgentId,
          createdBy: profile.createdBy,
          childAgents: [],
        },
      },
      { upsert: true, new: true },
    ).lean<IAgentCreatorProfile>();

    return serializeAgentCreatorProfile(updated);
  }

  async function rememberAgentCreatorChild(params: {
    creatorAgentId: string;
    createdBy: string;
    tenantId?: string;
    child: AgentCreatorChildAgentMemory;
  }): Promise<AgentCreatorProfile> {
    const AgentCreatorProfileModel = mongoose.models
      .AgentCreatorProfile as Model<IAgentCreatorProfile>;
    const updated = await AgentCreatorProfileModel.findOneAndUpdate(
      {
        creatorAgentId: params.creatorAgentId,
        createdBy: params.createdBy,
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      },
      {
        $set: {
          ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        },
        $setOnInsert: {
          creatorAgentId: params.creatorAgentId,
          createdBy: params.createdBy,
          preferences: {},
        },
        $addToSet: {
          childAgents: params.child,
        },
      },
      { upsert: true, new: true },
    ).lean<IAgentCreatorProfile>();

    return serializeAgentCreatorProfile(updated);
  }

  async function getAgentCreatorProfile(params: {
    creatorAgentId: string;
    createdBy: string;
    tenantId?: string;
  }): Promise<AgentCreatorProfile | null> {
    const AgentCreatorProfileModel = mongoose.models
      .AgentCreatorProfile as Model<IAgentCreatorProfile>;
    const profile = await AgentCreatorProfileModel.findOne({
      creatorAgentId: params.creatorAgentId,
      createdBy: params.createdBy,
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    }).lean<IAgentCreatorProfile | null>();
    return profile == null ? null : serializeAgentCreatorProfile(profile);
  }

  return { upsertAgentCreatorProfile, rememberAgentCreatorChild, getAgentCreatorProfile };
}

export type AgentCreatorProfileMethods = ReturnType<typeof createAgentCreatorProfileMethods>;
