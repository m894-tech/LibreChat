import { lazy, Suspense } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

const Design = lazy(() => import('./Design'));

export default function DesignGate() {
  const localize = useLocalize();
  const { data, isLoading } = useGetStartupConfig();

  if (isLoading) {
    return <div role="status">{localize('com_ui_design_loading')}</div>;
  }

  if (!(data?.interface as { design?: boolean } | undefined)?.design) {
    return (
      <div role="status" className="p-6 text-text-secondary">
        {localize('com_ui_design_disabled')}
      </div>
    );
  }

  return (
    <Suspense fallback={<div role="status">{localize('com_ui_design_loading_editor')}</div>}>
      <Design />
    </Suspense>
  );
}
