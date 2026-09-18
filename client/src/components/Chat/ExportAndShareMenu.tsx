import { useState, useId } from 'react';
import { Share2 } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { DropdownPopup, TooltipAnchor, useMediaQuery, composerControlClasses } from '@librechat/client';
import useExportShare from '~/hooks/Chat/useExportShare';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ExportAndShareMenu({
  isSharedButtonEnabled,
  className,
}: {
  isSharedButtonEnabled: boolean;
  className?: string;
}) {
  const localize = useLocalize();
  const menuId = useId();
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { show, items, hasSharedLink, dialogs } = useExportShare({ isSharedButtonEnabled });

  if (!show) {
    return null;
  }

  const description = localize(
    hasSharedLink ? 'com_ui_export_share_link_active' : 'com_endpoint_export_share',
  );

  return (
    <>
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        unmountOnHide={true}
        isOpen={isPopoverActive}
        setIsOpen={setIsPopoverActive}
        trigger={
          <TooltipAnchor
            description={description}
            render={
              <Ariakit.MenuButton
                id="export-menu-button"
                aria-label={description}
                data-testid="composer-export-share"
                className={cn(
                  composerControlClasses(),
                  'size-theme-control min-w-0 rounded-[9px] border-border-light bg-surface-secondary p-1 text-text-secondary shadow-none hover:border-border-medium hover:bg-surface-hover hover:text-text-primary hover:shadow-none',
                  isPopoverActive && 'bg-surface-hover text-text-primary',
                  className,
                )}
              >
                <Share2 className="size-4 text-current" aria-hidden="true" focusable="false" />
                {hasSharedLink && (
                  <span
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-status-info ring-2 ring-surface-secondary"
                    data-testid="shared-link-indicator"
                    aria-hidden="true"
                  />
                )}
              </Ariakit.MenuButton>
            }
          />
        }
        items={items}
        className={isSmallScreen ? '' : 'absolute right-0 top-0 mt-2'}
      />
      {dialogs}
    </>
  );
}
