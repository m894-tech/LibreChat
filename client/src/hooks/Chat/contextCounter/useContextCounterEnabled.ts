import { useGetStartupConfig } from '~/data-provider';

/** §11 rollout flag `interface.contextCounterV2`; `false` until the config has loaded. */
export default function useContextCounterEnabled(): boolean {
  const { data: startupConfig } = useGetStartupConfig();
  return startupConfig?.interface?.contextCounterV2 === true;
}
