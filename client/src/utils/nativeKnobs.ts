export type NativeKnobPrimitive = string | number | boolean;
export type NativeKnobValue = NativeKnobPrimitive | { [key: string]: NativeKnobValue };

export type NativeKnobChip = {
  id: string;
  label: string;
  apply: Record<string, NativeKnobValue>;
  modelIncludes?: string[];
};

export type NativeKnobGroup = {
  id: string;
  label?: string;
  chips: NativeKnobChip[];
};

export type NativeKnobFamily = {
  id: string;
  label: string;
  kind: 'image' | 'video' | 'search' | 'audio' | 'text';
  match: string[];
  excludePrefixes?: string[];
  excludeIncludes?: string[];
  defaults: Record<string, NativeKnobValue>;
  groups: NativeKnobGroup[];
  note?: string;
};

export type NativeKnobManifest = {
  version: number;
  families: NativeKnobFamily[];
};

export type NativeKnobsPayload = Record<string, NativeKnobValue> & { family: string };

export const NATIVE_KNOBS_MANIFEST_URL = '/assets/native-knobs.json';
export const NATIVE_KNOBS_STORAGE_KEY = 'm894-native-knobs-v1';

export function sameNativeKnobValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  return false;
}

export function matchNativeKnobFamily(
  families: NativeKnobFamily[],
  hints: { model?: string | null; spec?: string | null; label?: string | null },
): NativeKnobFamily | null {
  const model = String(hints.model ?? '');
  const spec = String(hints.spec ?? '');
  const label = String(hints.label ?? '');
  const haystack = `${model} ${spec} ${label}`.toLowerCase();

  return (
    families.find((family) => {
      const excluded = (family.excludePrefixes ?? []).some(
        (prefix) => spec.startsWith(prefix) || label.startsWith(prefix),
      );
      if (excluded) {
        return false;
      }
      const excludedIncludes = (family.excludeIncludes ?? []).some((token) =>
        haystack.includes(token.toLowerCase()),
      );
      if (excludedIncludes) {
        return false;
      }
      return family.match.some((candidate) => haystack.includes(candidate.toLowerCase()));
    }) ?? null
  );
}

export function mergeNativeKnobValues(
  family: NativeKnobFamily,
  saved?: Record<string, NativeKnobValue> | null,
): Record<string, NativeKnobValue> {
  const allowed = new Map<string, NativeKnobValue[]>();
  for (const group of family.groups) {
    for (const chip of group.chips) {
      for (const [key, value] of Object.entries(chip.apply)) {
        allowed.set(key, [...(allowed.get(key) ?? []), value]);
      }
    }
  }
  const result: Record<string, NativeKnobValue> = {};
  for (const [key, values] of allowed) {
    const savedValue = saved?.[key];
    const defaultValue = family.defaults[key];
    const candidate = values.some((value) => sameNativeKnobValue(value, savedValue))
      ? savedValue
      : defaultValue;
    if (candidate !== undefined && values.some((value) => sameNativeKnobValue(value, candidate))) {
      result[key] = candidate;
    }
  }
  return result;
}

export function createNativeKnobsPayload(
  family: NativeKnobFamily | null,
  values: Record<string, NativeKnobValue>,
): NativeKnobsPayload | undefined {
  if (!family) {
    return undefined;
  }
  return { family: family.id, ...mergeNativeKnobValues(family, values) };
}

export function isNativeKnobChipActive(
  values: Record<string, NativeKnobValue>,
  chip: NativeKnobChip,
): boolean {
  return Object.entries(chip.apply).every(([key, value]) =>
    sameNativeKnobValue(values[key], value),
  );
}

export function filterNativeKnobFamilyForModel(
  family: NativeKnobFamily | null,
  model?: string | null,
): NativeKnobFamily | null {
  if (!family) {
    return null;
  }
  const normalizedModel = String(model ?? '').toLowerCase();
  return {
    ...family,
    groups: family.groups
      .map((group) => ({
        ...group,
        chips: group.chips.filter((chip) =>
          (chip.modelIncludes ?? []).every((token) =>
            normalizedModel.includes(token.toLowerCase()),
          ),
        ),
      }))
      .filter((group) => group.chips.length > 0),
  };
}

/** Groups that mirror SessionEffortSection (conversation.effort SoT). */
export function isEffortKnobGroup(group: NativeKnobGroup): boolean {
  const id = group.id.toLowerCase();
  const label = (group.label ?? '').toLowerCase();
  if (id.includes('effort') || label.includes('effort')) {
    return true;
  }
  return group.chips.some((chip) =>
    Object.keys(chip.apply).some((key) => key.toLowerCase() === 'effort'),
  );
}

/**
 * Dense v5.1: Effort Low/Mid/High lives only in SessionEffortSection.
 * Strip overlapping native-knob effort groups so the sheet cannot show two
 * desynced Effort controls (conversation.effort vs localStorage knobs).
 */
export function withoutEffortKnobGroups(family: NativeKnobFamily | null): NativeKnobFamily | null {
  if (!family) {
    return null;
  }
  const groups = family.groups.filter((group) => !isEffortKnobGroup(group));
  if (groups.length === 0) {
    return null;
  }
  return { ...family, groups };
}
