import { extendedSystemPackages } from '../extended-systems';
import { createSystemResolver } from '../system-resolver';
import { validateBrandPackage } from '../brand-package';
import { applyOperations } from '../operations';
it('nine candidates are executable pinned packages, not Markdown only, without global mutation', () => {
  const candidates = extendedSystemPackages();
  expect(candidates).toHaveLength(9);
  for (const c of candidates) {
    const p = validateBrandPackage(c.brand);
    const resolver = createSystemResolver([p]);
    const doc: any = {
      id: 'd',
      projectId: 'p',
      kind: 'canvas',
      schemaVersion: 1,
      title: 'Preview',
      revision: 1,
      designSystem: { id: 'neutral-business', version: '1.0.0' },
      assetRefs: [],
      archived: false,
      payload: { width: 1080, height: 1350, nodes: [] },
    };
    const result = applyOperations(
      doc,
      {
        operationId: 'theme',
        expectedRevision: 1,
        declaredScope: [],
        operations: [{ type: 'applySystem', systemId: p.id, systemVersion: p.version }],
      },
      { actorId: 'u', role: 'owner', agent: false },
      resolver,
    );
    expect(result.designSystem.id).toBe(p.id);
    expect(c.reviewStatus).toBe('candidate');
    expect(c.referenceURLs.length).toBeGreaterThan(0);
  }
});
