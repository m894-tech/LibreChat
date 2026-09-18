import { PlusCircle } from 'lucide-react';
import { TooltipAnchor, composerControlClasses } from '@librechat/client';
import useMultiConvo from '~/hooks/Chat/useMultiConvo';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type AddMultiConvoProps = {
  className?: string;
};

function AddMultiConvo({ className }: AddMultiConvoProps) {
  const localize = useLocalize();
  const { show, addConversation } = useMultiConvo();

  if (!show) {
    return null;
  }

  return (
    <TooltipAnchor
      description={localize('com_ui_add_multi_conversation')}
      role="button"
      tabIndex={0}
      aria-label={localize('com_ui_add_multi_conversation')}
      onClick={addConversation}
      data-testid="add-multi-convo-button"
      className={cn(
        composerControlClasses(),
        'size-theme-control min-w-0 cursor-pointer rounded-[9px] border-border-light bg-surface-secondary p-1 text-text-secondary shadow-none hover:border-border-medium hover:bg-surface-hover hover:text-text-primary hover:shadow-none',
        className,
      )}
    >
      <PlusCircle className="size-4" aria-hidden="true" />
    </TooltipAnchor>
  );
}

export default AddMultiConvo;
