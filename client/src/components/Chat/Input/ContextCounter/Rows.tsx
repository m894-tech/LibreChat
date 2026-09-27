import { MeterSwatch } from '@librechat/client';
import { formatContextTokensExact } from 'librechat-data-provider';
import type { ContextCounterFormatter } from './hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ValueProps {
  value: number;
  budget: number | null;
  /** `≈` in front of an estimated composition value (§10.6). */
  approximate?: boolean;
  format: ContextCounterFormatter;
}

/** Compact value with the exact integer on hover (§9 «в деталях — точные значения»). */
export function TokenValue({ value, budget, approximate = false, format }: ValueProps) {
  const localize = useLocalize();
  const compact = format.tokens(value);
  const percent = format.percent(value, budget);
  return (
    <span
      className="shrink-0 whitespace-nowrap font-medium tabular-nums text-text-primary"
      title={formatContextTokensExact(value)}
    >
      {approximate ? localize('com_ui_cc_approx', { 0: compact }) : compact}
      {percent != null && (
        <span className="ml-1 inline-block min-w-[3ch] text-right text-xs text-text-secondary">
          {percent}
        </span>
      )}
    </span>
  );
}

interface SegmentRowProps extends ValueProps {
  id: string;
  label: string;
  slot: number;
  onHoverChange?: (id: string | null) => void;
}

/** `●` row: a component of `occupied`, keyed to its slice of the bar. */
export function SegmentRow({ id, label, slot, onHoverChange, ...value }: SegmentRowProps) {
  const localize = useLocalize();
  return (
    <div
      className="flex w-full items-center justify-between gap-4 text-sm"
      data-testid={`cc-row-${id}`}
      onPointerEnter={onHoverChange != null ? () => onHoverChange(id) : undefined}
      onPointerLeave={onHoverChange != null ? () => onHoverChange(null) : undefined}
    >
      <span className="flex min-w-0 items-center gap-2">
        <MeterSwatch segment={{ slot }} />
        <span className="sr-only">{localize('com_ui_cc_segment_sr')}</span>
        <span className="min-w-0 break-words text-text-secondary">{label}</span>
      </span>
      <TokenValue {...value} />
    </div>
  );
}

interface InfoRowProps extends Omit<ValueProps, 'value'> {
  id: string;
  label: string;
  /** `null` renders «—»: no honest number before the call (§5 cache rule). */
  value: number | null;
  onHoverChange?: (id: string | null) => void;
  className?: string;
}

/** `○` row: cache or free space — reference only, never a bar segment. */
export function InfoRow({ id, label, value, onHoverChange, className, ...rest }: InfoRowProps) {
  const localize = useLocalize();
  return (
    <div
      className={cn('flex w-full items-center justify-between gap-4 text-sm', className)}
      data-testid={`cc-row-${id}`}
      onPointerEnter={onHoverChange != null ? () => onHoverChange(id) : undefined}
      onPointerLeave={onHoverChange != null ? () => onHoverChange(null) : undefined}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 flex-none rounded-sm bg-surface-tertiary ring-1 ring-inset ring-border-heavy"
        />
        <span className="sr-only">{localize('com_ui_cc_info_sr')}</span>
        <span className="min-w-0 break-words text-text-secondary">{label}</span>
      </span>
      {value == null ? (
        <span className="shrink-0 font-medium text-text-tertiary">—</span>
      ) : (
        <TokenValue value={value} {...rest} />
      )}
    </div>
  );
}

interface PlainRowProps {
  label: string;
  value: number;
  format: ContextCounterFormatter;
  indent?: boolean;
  testId?: string;
}

/** Spend row: a count with no share of the window (§5 «Расход сессии»). */
export function PlainRow({ label, value, format, indent = false, testId }: PlainRowProps) {
  return (
    <div
      className={cn('flex w-full items-center justify-between gap-4 text-sm', indent && 'pl-4')}
      data-testid={testId}
    >
      <span className="min-w-0 break-words text-text-secondary">{label}</span>
      <TokenValue value={value} budget={null} format={format} />
    </div>
  );
}
