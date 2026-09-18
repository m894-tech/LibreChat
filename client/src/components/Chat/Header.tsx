import { memo } from 'react';
import { useRecoilValue } from 'recoil';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { TemporaryChat, TemporaryChatIndicator } from './TemporaryChat';
import SubagentThreadLink from './SubagentThreadLink';
import { OpenSidebar } from './Menus';
import { useHasAccess } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

/**
 * Session chrome owns model / bookmarks / export / private at every breakpoint
 * (SessionPanel → More). New conversation is the dashed control on the composer
 * tools row (`session-new-conversation`). The header keeps the mobile sidebar
 * opener, temporary-chat mark, and optional subagent title — controls the e2e
 * header surface and temporary-chat scenarios still drive.
 *
 * `header-open-sidebar-button` stays distinct from the rail's `open-sidebar-button`
 * so `getByTestId('open-sidebar-button')` resolves to one element.
 */
function Header({ parentConversationId }: { parentConversationId?: string; readOnly?: boolean }) {
  const navVisible = useRecoilValue(store.sidebarExpanded);
  const hasAccessToTemporaryChat = useHasAccess({
    permissionType: PermissionTypes.TEMPORARY_CHAT,
    permission: Permissions.USE,
  });

  /** The drawer covers the header on mobile; keep its controls out of the tab order. */
  const hiddenBehindNav = navVisible === true && 'max-md:hidden';

  return (
    <div className="absolute top-0 z-10 flex h-[52px] w-full items-center gap-2 bg-gradient-to-b from-presentation via-presentation/70 to-transparent p-2 font-semibold text-text-primary md:from-presentation/80 md:via-presentation/50 2xl:from-presentation/0 2xl:via-transparent">
      <div className="flex flex-shrink-0 items-center md:hidden">
        <OpenSidebar testId="header-open-sidebar-button" />
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 md:pl-3 md:transition-all md:duration-200 md:ease-in-out',
          hiddenBehindNav,
        )}
      >
        {parentConversationId != null && (
          <SubagentThreadLink threadId={parentConversationId} labelClassName="hidden lg:inline" />
        )}
      </div>

      <div className={cn('flex flex-shrink-0 items-center gap-2', hiddenBehindNav)}>
        {hasAccessToTemporaryChat === true && <TemporaryChatIndicator />}
        <div className="hidden items-center gap-2 md:flex">
          {hasAccessToTemporaryChat === true && <TemporaryChat />}
        </div>
      </div>
    </div>
  );
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;
