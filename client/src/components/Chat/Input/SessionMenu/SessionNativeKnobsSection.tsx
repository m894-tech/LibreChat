import React from 'react';
import type { TConversation } from 'librechat-data-provider';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';
import { isNativeKnobChipActive } from '~/utils/nativeKnobs';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SessionNativeKnobsSectionProps = {
  conversation?: TConversation | null;
  controls?: NativeModelControls | null;
  className?: string;
};

export default function SessionNativeKnobsSection({
  controls,
  className,
}: SessionNativeKnobsSectionProps) {
  const localize = useLocalize();
  if (controls == null || controls.family == null) {
    return null;
  }
  const resolved = controls;
  const family = resolved.family;
  if (family == null) {
    return null;
  }

  return (
    <div className={cn('w-full px-0.5', className)} data-testid="session-native-knobs">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-text-secondary">
        {localize('com_ui_native_knobs')} · {family.label}
      </div>
      <div className="flex flex-col gap-1.5">
        {family.groups.map((group) => (
          <div key={group.id} className="flex flex-wrap items-center gap-1.5">
            <div className="shrink-0 text-[10px] text-text-secondary">
              {group.label ?? group.id}
            </div>
            <div
              className="flex flex-wrap gap-1"
              role="radiogroup"
              aria-label={group.label ?? group.id}
            >
              {group.chips.map((chip) => {
                const active = isNativeKnobChipActive(resolved.values, chip);
                return (
                  <button
                    key={chip.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`native-knob-${group.id}-${chip.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      resolved.applyChip(chip);
                    }}
                    className={cn(
                      'rounded-md border px-2 py-0.5 text-[11px] leading-snug',
                      active
                        ? 'border-border-heavy bg-surface-hover text-text-primary'
                        : 'border-border-light bg-surface-tertiary text-text-secondary hover:border-border-heavy hover:text-text-primary',
                    )}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {family.note ? <p className="text-[10px] text-text-secondary">{family.note}</p> : null}
      </div>
    </div>
  );
}
