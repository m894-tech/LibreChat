import React from 'react';
import { cn } from '~/utils';

type ChipScrollerProps = {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
};

/** Horizontal no-wrap chip row for dense Session «Сейчас». */
export default function ChipScroller({
  children,
  className,
  'aria-label': ariaLabel,
}: ChipScrollerProps) {
  return (
    <div
      role="list"
      aria-label={ariaLabel}
      data-testid="session-chip-scroller"
      className={cn(
        '-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {React.Children.map(children, (child, i) => {
        if (child == null || child === false) {
          return null;
        }
        return (
          <div key={i} role="listitem" className="shrink-0">
            {child}
          </div>
        );
      })}
    </div>
  );
}
