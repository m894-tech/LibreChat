import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TConversation, TModelSpec } from 'librechat-data-provider';
import type {
  NativeKnobChip,
  NativeKnobManifest,
  NativeKnobsPayload,
  NativeKnobValue,
} from '~/utils/nativeKnobs';
import {
  NATIVE_KNOBS_MANIFEST_URL,
  NATIVE_KNOBS_STORAGE_KEY,
  createNativeKnobsPayload,
  filterNativeKnobFamilyForModel,
  matchNativeKnobFamily,
  mergeNativeKnobValues,
  withoutEffortKnobGroups,
} from '~/utils/nativeKnobs';
import { useGetStartupConfig } from '~/data-provider';

let manifestPromise: Promise<NativeKnobManifest> | null = null;

function getManifest(): Promise<NativeKnobManifest> {
  manifestPromise ??= fetch(NATIVE_KNOBS_MANIFEST_URL, { cache: 'no-store' }).then((response) => {
    if (!response.ok) {
      throw new Error(`Native model controls manifest HTTP ${response.status}`);
    }
    return response.json() as Promise<NativeKnobManifest>;
  });
  return manifestPromise;
}

function readStoredValues(): Record<string, Record<string, NativeKnobValue>> {
  try {
    return JSON.parse(localStorage.getItem(NATIVE_KNOBS_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export type NativeModelControls = {
  family: NativeKnobManifest['families'][number] | null;
  values: Record<string, NativeKnobValue>;
  payload?: NativeKnobsPayload;
  applyChip: (chip: NativeKnobChip) => void;
};

type UseNativeModelControlsOptions = {
  /** When false, skip the manifest fetch (sessionMenu off-path). */
  enabled?: boolean;
};

export function useNativeModelControls(
  conversation?: TConversation | null,
  options?: UseNativeModelControlsOptions,
): NativeModelControls {
  const enabled = options?.enabled !== false;
  const { data: startupConfig } = useGetStartupConfig();
  const [manifest, setManifest] = useState<NativeKnobManifest>({ version: 1, families: [] });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    getManifest()
      .then((next) => active && setManifest(next))
      .catch((error) => {
        manifestPromise = null;
        console.warn('[native-model-controls]', error);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  const modelSpec = useMemo(
    () =>
      (startupConfig?.modelSpecs?.list as TModelSpec[] | undefined)?.find(
        (candidate) => candidate.name === conversation?.spec,
      ),
    [conversation?.spec, startupConfig?.modelSpecs?.list],
  );
  const model = modelSpec?.preset?.model ?? conversation?.model;
  const label = modelSpec?.label ?? conversation?.modelLabel;
  const family = useMemo(
    () =>
      withoutEffortKnobGroups(
        filterNativeKnobFamilyForModel(
          matchNativeKnobFamily(manifest.families, {
            model,
            spec: conversation?.spec,
            label,
          }),
          model,
        ),
      ),
    [conversation?.spec, label, manifest.families, model],
  );
  const [selectedByFamily, setSelectedByFamily] = useState<
    Record<string, Record<string, NativeKnobValue>>
  >(() => readStoredValues());
  const values = useMemo(
    () => (family ? mergeNativeKnobValues(family, selectedByFamily[family.id]) : {}),
    [family, selectedByFamily],
  );

  const applyChip = useCallback(
    (chip: NativeKnobChip) => {
      if (!family) {
        return;
      }
      setSelectedByFamily((previous) => {
        const next = mergeNativeKnobValues(family, {
          ...(previous[family.id] ?? {}),
          ...chip.apply,
        });
        const updated = { ...previous, [family.id]: next };
        localStorage.setItem(NATIVE_KNOBS_STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    [family],
  );

  const payload = useMemo(() => createNativeKnobsPayload(family, values), [family, values]);
  return { family, values, payload, applyChip };
}
