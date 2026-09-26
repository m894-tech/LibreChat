import { useNavigate } from 'react-router-dom';
import { useLocalize } from '~/hooks';

export default function DesignNavPanel() {
  const navigate = useNavigate();
  const localize = useLocalize();

  return (
    <div className="space-y-3 p-4">
      <h2 className="font-semibold text-text-primary">{localize('com_ui_design_nav_title')}</h2>
      <p className="text-sm text-text-secondary">{localize('com_ui_design_nav_blurb')}</p>
      <button
        className="rounded-lg border border-border-light px-3 py-2 text-text-primary hover:bg-surface-hover"
        type="button"
        onClick={() => navigate('/design')}
      >
        {localize('com_ui_design_nav_open')}
      </button>
    </div>
  );
}
