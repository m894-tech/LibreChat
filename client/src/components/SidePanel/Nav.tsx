import { useLocation } from 'react-router-dom';
import type { NavLink } from '~/common';
import { useActivePanel, resolveEffectivePanel } from '~/Providers';

export default function Nav({ links }: { links: NavLink[] }) {
  const location = useLocation();
  const { active } = useActivePanel();
  const effectiveActive = resolveEffectivePanel(location.pathname, active, links);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-text-primary">
      {links.map((link) =>
        link.id === effectiveActive && link.Component ? <link.Component key={link.id} /> : null,
      )}
    </div>
  );
}
