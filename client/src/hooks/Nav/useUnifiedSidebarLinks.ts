import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, MessagesSquare, Paintbrush } from 'lucide-react';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { getConfigDefaults, getEndpointField } from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import { useGetEndpointsQuery, useGetStartupConfig, useInsightsAccessQuery } from '~/data-provider';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import DesignNavPanel from '~/components/UnifiedSidebar/DesignNavPanel';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import { useAuthContext } from '~/hooks';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

export default function useUnifiedSidebarLinks() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthContext();
  /** Selector instead of the full conversation atom: the links only depend on
   * the endpoint, so parameter edits and other conversation writes stay out. */
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(0)) ?? undefined;
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );
  const insightsFeatureEnabled = startupConfig?.insightsEnabled === true;
  const isInsightsRoute = location.pathname.startsWith('/insights');
  const { data: insightsAccess, isLoading: isInsightsAccessLoading } = useInsightsAccessQuery(
    user?.id,
    {
      enabled: !!user && insightsFeatureEnabled && !isInsightsRoute,
    },
  );

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');

  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const sideNavLinks = useSideNavLinks({
    keyProvided,
    endpoint,
    endpointType,
    interfaceConfig,
    endpointsConfig,
    includeHidePanel: false,
  });

  const links = useMemo(() => {
    const conversationLink: NavLink = {
      title: 'com_ui_chat_history',
      label: '',
      icon: MessagesSquare,
      id: 'conversations',
      Component: ConversationsSection,
    };

    const designLinks: NavLink[] =
      (interfaceConfig as { design?: boolean }).design === true
        ? [
            {
              title: 'com_ui_design',
              label: '',
              icon: Paintbrush,
              id: 'design',
              Component: DesignNavPanel,
            },
          ]
        : [];

    if (
      !insightsFeatureEnabled ||
      (!isInsightsRoute && !isInsightsAccessLoading && insightsAccess?.access !== true)
    ) {
      return [conversationLink, ...designLinks, ...sideNavLinks];
    }

    const insightsLink: NavLink = {
      title: 'com_insights_navigation',
      label: '',
      icon: BarChart3,
      id: 'insights',
      disabled: !isInsightsRoute && isInsightsAccessLoading,
      onClick: () => {
        if (!location.pathname.startsWith('/insights')) {
          navigate('/insights');
        }
      },
    };
    const mcpIndex = sideNavLinks.findIndex((link) => link.id === 'mcp-builder');
    const nextLinks = [...sideNavLinks];
    nextLinks.splice(mcpIndex >= 0 ? mcpIndex + 1 : nextLinks.length, 0, insightsLink);

    return [conversationLink, ...designLinks, ...nextLinks];
  }, [
    insightsAccess?.access,
    insightsFeatureEnabled,
    interfaceConfig,
    isInsightsAccessLoading,
    isInsightsRoute,
    location.pathname,
    navigate,
    sideNavLinks,
  ]);

  return links;
}
