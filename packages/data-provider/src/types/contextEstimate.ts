import type { TPayload } from '../types';
import type { TFile } from './files';

/**
 * Body of `POST /api/agents/context/estimate` (context counter v2 §6). The
 * client sends the same conversation/endpoint fields it would send to
 * `POST /api/agents/chat`, so the server resolves the agent, model spec and
 * files through the same middleware as Send, plus the draft, the leaf of the
 * branch and a monotonically increasing `revision` the response echoes back so
 * a late reply for a superseded draft can be dropped (§6 invariants 2–3).
 */
export type TContextEstimateRequest = Pick<TPayload, 'ephemeralAgent'> &
  Partial<
    Pick<
      TPayload,
      | 'endpoint'
      | 'endpointType'
      | 'agent_id'
      | 'model'
      | 'spec'
      | 'quotes'
      | 'manualSkills'
      | 'addedConvo'
      | 'promptPrefix'
      | 'maxContextTokens'
      | 'maxOutputTokens'
      | 'iconURL'
      | 'chatProjectId'
    >
  > & {
    /** `Constants.NEW_CONVO` (or `null`) for a chat that is not persisted yet. */
    conversationId: string | null;
    /** Leaf message of the branch to estimate; `Constants.NO_PARENT` for an empty chat. */
    parentMessageId: string;
    /** Client-side revision of the draft/configuration this estimate is for; echoed back. */
    revision: number;
    /** Draft text the user has typed so far. */
    text?: string;
    /** Prepared attachments — ids or file objects; an unprocessed one makes the estimate `partial`. */
    files?: Array<string | Pick<TFile, 'file_id'>>;
    /**
     * Client-side §7 fingerprint. Not used by the server, which computes its own
     * from the resolved plan and returns it as `fingerprint`; clients match late
     * answers by `revision`.
     */
    fingerprint?: string;
  };
