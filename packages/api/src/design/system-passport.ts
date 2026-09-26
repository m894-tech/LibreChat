import { getSystem, type DesignSystemPackage } from './systems';
import { DesignError } from './errors';
export interface SystemPassport {
  id: string;
  version: string;
  manifestVersion: 1;
  system: DesignSystemPackage;
  adapters: {
    canvas: 'token-bindings';
    web: 'materialized-colors';
    presentation: 'raster-handoff';
    image: 'style-guidance-only';
  };
  fonts: readonly string[];
  notes: string;
}
export function getSystemPassport(id: string, version: string): SystemPassport {
  const system = getSystem(id, version);
  if (!system) throw new DesignError(404, 'system_missing', 'System not found');
  return {
    id,
    version,
    manifestVersion: 1,
    system: JSON.parse(JSON.stringify(system)),
    adapters: {
      canvas: 'token-bindings',
      web: 'materialized-colors',
      presentation: 'raster-handoff',
      image: 'style-guidance-only',
    },
    fonts: [...system.fonts],
    notes:
      'Raster assets are not automatically recolored. Web colors and branded snapshots are materialized, not live bindings. Cyrillic fonts shipped with OFL licences. Readability requires human acceptance.',
  };
}
