import { EModelEndpoint } from 'librechat-data-provider';
import type { TContextEstimateConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

export type ResolvedContextEstimateConfig = {
  enabled: boolean;
  burst: number;
  perMinute: number;
  maxExcludedPreviews: number;
};

/** §6.6 defaults: burst 5, ≤30 requests per minute per user + conversation. */
export const CONTEXT_ESTIMATE_DEFAULTS: ResolvedContextEstimateConfig = {
  enabled: true,
  burst: 5,
  perMinute: 30,
  maxExcludedPreviews: 20,
};

/** Reads `endpoints.agents.contextEstimate` from `librechat.yaml`, filling §6.6 defaults. */
export function resolveContextEstimateConfig(
  appConfig: Pick<AppConfig, 'endpoints'> | undefined,
): ResolvedContextEstimateConfig {
  const configured: TContextEstimateConfig | undefined =
    appConfig?.endpoints?.[EModelEndpoint.agents]?.contextEstimate;
  return {
    enabled: configured?.enabled !== false,
    burst: configured?.rateLimit?.burst ?? CONTEXT_ESTIMATE_DEFAULTS.burst,
    perMinute: configured?.rateLimit?.perMinute ?? CONTEXT_ESTIMATE_DEFAULTS.perMinute,
    maxExcludedPreviews:
      configured?.maxExcludedPreviews ?? CONTEXT_ESTIMATE_DEFAULTS.maxExcludedPreviews,
  };
}
