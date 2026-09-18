import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getRouteActivePanel, useActivePanel } from '~/Providers';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';

/**
 * Keep the UnifiedSidebar list in lockstep with management routes.
 * `/skills` empty state tells the user to pick from the sidebar — without this
 * sync, localStorage can leave Projects+Chats mounted while SkillsView waits.
 */
export default function SyncActivePanelToRoute() {
  const location = useLocation();
  const { setActive } = useActivePanel();
  const { setSidebarOpen } = useSidebarToggle();

  useEffect(() => {
    const routePanel = getRouteActivePanel(location.pathname);
    if (routePanel === 'skills' || routePanel === 'prompts') {
      setActive(routePanel);
      setSidebarOpen(true);
    }
  }, [location.pathname, setActive, setSidebarOpen]);

  return null;
}
