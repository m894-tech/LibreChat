import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

const STORAGE_KEY = 'side:active-panel';
export const DEFAULT_PANEL = 'conversations';

function getInitialActivePanel(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? saved : DEFAULT_PANEL;
}

/**
 * Route-owned sidebar panels. When the main pane is Skills / Prompts / Insights
 * management chrome, the left list must match — otherwise `/skills` shows
 * "Select a skill" while Projects+Chats stay in the rail (Manage from Session).
 */
export function getRouteActivePanel(pathname: string): string | undefined {
  if (pathname.startsWith('/insights')) {
    return 'insights';
  }
  if (pathname.startsWith('/skills')) {
    return 'skills';
  }
  if (pathname === '/prompts' || pathname.startsWith('/prompts/')) {
    return 'prompts';
  }
  return undefined;
}

interface ActivePanelContextType {
  active: string;
  setActive: (id: string) => void;
}

const ActivePanelContext = createContext<ActivePanelContextType | undefined>(undefined);

export function ActivePanelProvider({ children }: { children: ReactNode }) {
  const [active, _setActive] = useState<string>(getInitialActivePanel);

  const setActive = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    _setActive(id);
  }, []);

  const value = useMemo(() => ({ active, setActive }), [active, setActive]);

  return <ActivePanelContext.Provider value={value}>{children}</ActivePanelContext.Provider>;
}

export function useActivePanel() {
  const context = useContext(ActivePanelContext);
  if (context === undefined) {
    throw new Error('useActivePanel must be used within an ActivePanelProvider');
  }
  return context;
}

/** Returns `active` when it matches a known link, otherwise the first link's id. */
export function resolveActivePanel(active: string, links: { id: string }[]): string {
  if (links.length > 0 && links.some((l) => l.id === active)) {
    return active;
  }
  return links[0]?.id ?? active;
}

/** Prefer a route-owned panel when that link exists in the rail. */
export function resolveEffectivePanel(
  pathname: string,
  active: string,
  links: { id: string }[],
): string {
  const routePanel = getRouteActivePanel(pathname);
  if (routePanel != null && links.some((link) => link.id === routePanel)) {
    return routePanel;
  }
  return resolveActivePanel(active, links);
}
