import { memo } from 'react';
import { useRecoilValue } from 'recoil';
import SubagentThreadLink from './SubagentThreadLink';
import { OpenSidebar } from './Menus';
import store from '~/store';

/**
 * Session chrome lives in the composer SessionSheet at every breakpoint.
 * Header is sidebar (+ optional subagent title) only — model / bookmarks /
 * export / private move into SessionPanel → More.
 */
function Header({ parentConversationId }: { parentConversationId?: string; readOnly?: boolean }) {
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);

  return (
    <div className="absolute top-0 z-10 flex h-[52px] w-full items-center justify-between bg-gradient-to-b from-presentation via-presentation/70 to-transparent p-2 font-semibold text-text-primary md:from-presentation/80 md:via-presentation/50 2xl:from-presentation/0 2xl:via-transparent">
      <div className="hide-scrollbar flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center gap-2">
          {!sidebarExpanded ? <OpenSidebar /> : null}
          {parentConversationId != null && (
            <SubagentThreadLink threadId={parentConversationId} labelClassName="hidden lg:inline" />
          )}
        </div>
      </div>
      <div />
    </div>
  );
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;
