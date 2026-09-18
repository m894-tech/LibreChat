import { useState, useId } from 'react';
import { useRecoilValue } from 'recoil';
import * as Ariakit from '@ariakit/react';
import { BookmarkFilledIcon, BookmarkIcon } from '@radix-ui/react-icons';
import { DropdownPopup, TooltipAnchor, Spinner, composerControlClasses } from '@librechat/client';
import type { FC } from 'react';
import { BookmarkContext } from '~/Providers/BookmarkContext';
import useBookmarkItems from '~/hooks/Chat/useBookmarkItems';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type BookmarkMenuProps = {
  className?: string;
};

const BookmarkMenu: FC<BookmarkMenuProps> = ({ className }) => {
  const localize = useLocalize();
  const menuId = useId();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const conversationId = useRecoilValue(store.conversationByIndex(0))?.conversationId ?? '';
  const { show, items, bookmarks, hasBookmarks, isLoading, triggerAriaLabel, dialog } =
    useBookmarkItems();

  if (!show) {
    return null;
  }

  const renderButtonContent = () => {
    if (isLoading) {
      return <Spinner aria-label="Spinner" />;
    }
    if (hasBookmarks) {
      return <BookmarkFilledIcon className="size-4" aria-hidden="true" />;
    }
    return <BookmarkIcon className="size-4" aria-hidden="true" />;
  };

  return (
    <BookmarkContext.Provider value={{ bookmarks }}>
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        isOpen={isMenuOpen}
        unmountOnHide={true}
        setIsOpen={setIsMenuOpen}
        keyPrefix={`${conversationId}-bookmark-`}
        trigger={
          <TooltipAnchor
            description={localize('com_ui_bookmarks_add')}
            render={
              <Ariakit.MenuButton
                id="bookmark-menu-button"
                aria-label={triggerAriaLabel}
                aria-pressed={hasBookmarks}
                data-testid="bookmark-menu"
                className={cn(
                  composerControlClasses(),
                  'size-theme-control min-w-0 rounded-[9px] border-border-light bg-surface-secondary p-1 text-text-secondary shadow-none hover:border-border-medium hover:bg-surface-hover hover:text-text-primary hover:shadow-none',
                  isMenuOpen && 'bg-surface-hover text-text-primary',
                  className,
                )}
              >
                {renderButtonContent()}
              </Ariakit.MenuButton>
            }
          />
        }
        items={items}
      />
      {dialog}
    </BookmarkContext.Provider>
  );
};

export default BookmarkMenu;
