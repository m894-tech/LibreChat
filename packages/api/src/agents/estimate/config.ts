import { EModelEndpoint } from 'librechat-data-provider';
import type { TContextEstimateConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

export type ResolvedContextEstimateConfig = {
  /** `interface.contextCounterV2` — the single §11 rollout flag shared with the client. */
  enabled: boolean;
  burst: number;
  perMinute: number;
  maxExcludedPreviews: number;
};

/** §6.6 defaults: burst 5, ≤30 requests per minute per user + conversation. */
export const CONTEXT_ESTIMATE_DEFAULTS: ResolvedContextEstimateConfig = {
  enabled: false,
  burst: 5,
  perMinute: 30,
  maxExcludedPreviews: 20,
};

/**
 * Reads the rollout flag `interface.contextCounterV2` and the
 * `endpoints.agents.contextEstimate` levers from `librechat.yaml`, filling §6.6
 * defaults. The flag is off until an operator enables the v2 counter, so the
 * endpoint and the client menu switch together.
 */
export function resolveContextEstimateConfig(
  appConfig: Pick<AppConfig, 'endpoints' | 'interfaceConfig'> | undefined,
): ResolvedContextEstimateConfig {
  const configured: TContextEstimateConfig | undefined =
    appConfig?.endpoints?.[EModelEndpoint.agents]?.contextEstimate;
  return {
    enabled: appConfig?.interfaceConfig?.contextCounterV2 === true,
    burst: configured?.rateLimit?.burst ?? CONTEXT_ESTIMATE_DEFAULTS.burst,
    perMinute: configured?.rateLimit?.perMinute ?? CONTEXT_ESTIMATE_DEFAULTS.perMinute,
    maxExcludedPreviews:
      configured?.maxExcludedPreviews ?? CONTEXT_ESTIMATE_DEFAULTS.maxExcludedPreviews,
  };
}
