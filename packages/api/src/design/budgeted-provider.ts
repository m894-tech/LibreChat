import type { GenerationBudget } from './generation-budget';
import {
  ProviderUncertainError,
  type DesignGenerationProvider,
  type ProviderSubmitInput,
  type ProviderSubmitResult,
} from './providers';
/** Conservative allowance accounting, not the provider invoice. */
export function budgetedProvider(
  provider: DesignGenerationProvider,
  budget: GenerationBudget,
): DesignGenerationProvider {
  return {
    capabilities: provider.capabilities,
    async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
      await budget.reserve(input.jobId, input.principalId);
      await budget.claimDispatch(input.jobId, input.principalId);
      let result: ProviderSubmitResult;
      try {
        result = await provider.submit(input);
      } catch (error) {
        try {
          await budget.settle(input.jobId, 'uncertain');
        } catch {
          /* reservation retained */
        }
        throw error;
      }
      try {
        await budget.settle(input.jobId, result.kind === 'accepted' ? 'uncertain' : 'consumed');
      } catch {
        throw new ProviderUncertainError('Budget settlement uncertain; do not resubmit');
      }
      return result;
    },
    ...(provider.status ? { status: provider.status.bind(provider) } : {}),
  };
}
