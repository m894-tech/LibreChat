import type { TPayload } from '../types';

/**
 * Body of `POST /api/agents/context/estimate` (context counter v2 §6). The
 * client sends the same conversation/endpoint fields it would send to
 * `POST /api/agents/chat`, so the server resolves the agent, model spec and
 * files through the same middleware as Send, plus the draft, the leaf of the
 * branch and a monotonically increasing `revision` the response echoes back so
 * a late reply for a superseded draft can be dropped (§6 invariants 2–3).
 */
export type TContextEstimateRequest = Pick<TPayload, 'conversationId' | 'ephemeralAgent'> &
  Partial<
    Pick<
      TPayload,
      | 'endpoint'
      | 'endpointType'
      | 'agent_id'
      | 'model'
      | 'spec'
      | 'files'
      | 'quotes'
      | 'manualSkills'
      | 'addedConvo'
      | 'promptPrefix'
      | 'iconURL'
      | 'chatProjectId'
    >
  > & {
    /** Leaf message of the branch to estimate; `Constants.NO_PARENT` for an empty chat. */
    parentMessageId: string;
    /** Client-side revision of the draft/configuration this estimate is for. */
    revision: number;
    /** Draft text the user has typed so far. */
    text?: string;
  };
