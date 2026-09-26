import type {
  TContextConfiguration,
  TContextSessionUsage,
  TContextLastCallMeasurement,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';

/** Which snapshot the header, bar and breakdown describe (§3 toggle). */
export type ContextCounterMode = 'next' | 'last';

/** Host operations that gate the single bottom button (§3 table, §8 conflicts). */
export interface ContextCounterActivity {
  /** A model response is streaming: no action button, a waiting status instead. */
  streaming: boolean;
  /** Send is in flight (before the stream opens). */
  sending: boolean;
  compressing: boolean;
  modelSwitching: boolean;
}

export interface ContextCounterCapabilities {
  /** The endpoint supports compression; without it «Сжать» never shows. */
  compressionSupported: boolean;
  /** A dry-run estimate endpoint is wired; without it «Пересчитать» is disabled with a reason. */
  estimateSupported: boolean;
  /** Fill percent of the next request at which «Сжать» replaces «Пересчитать». */
  compressThresholdPercent: number;
}

/**
 * Everything the menu and the mini-indicator render from. Stream D's
 * hooks/selectors produce this object; the components stay pure and the wiring
 * is a single adapter. Field names follow §5/§7 of the spec and the shared
 * contract in `librechat-data-provider` (`TContext*`).
 */
export interface ContextCounterViewModel {
  conversationId: string | null;
  /** Configuration the user is about to send with; compared with each measurement's. */
  configuration: TContextConfiguration;
  nextRequestEstimate: TContextNextRequestEstimate | null;
  lastCallMeasurement: TContextLastCallMeasurement | null;
  /**
   * Host verdict that the last call was measured for another configuration
   * (model, agent or window limits). When omitted the model/provider fields
   * are compared locally.
   */
  lastCallMismatch?: boolean;
  sessionUsage: TContextSessionUsage | null;
  activity: ContextCounterActivity;
  capabilities: ContextCounterCapabilities;
  /** No messages yet: instructions and tools still occupy the window (§4). */
  isEmptyChat: boolean;
}

export interface ContextCounterActions {
  /** Re-runs the dry-run estimate; never calls the model, tools or a paid compress. */
  recalculate: () => void;
  /** Starts compression of the history before the next request. */
  compress: () => void;
}

export const IDLE_ACTIVITY: ContextCounterActivity = {
  streaming: false,
  sending: false,
  compressing: false,
  modelSwitching: false,
};

export const DEFAULT_CAPABILITIES: ContextCounterCapabilities = {
  compressionSupported: true,
  estimateSupported: true,
  compressThresholdPercent: 80,
};
