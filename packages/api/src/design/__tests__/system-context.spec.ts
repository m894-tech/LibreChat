import { withSystemRegistry, resolveScopedSystem } from '../system-context';
it('concurrent request registries never cross user contexts or leak globally', async () => {
  const system = (name: string) => ({ id: 'team', version: '1.0.0', name, tokens: {}, fonts: [] });
  const values = await Promise.all(
    ['A', 'B'].map((name) =>
      withSystemRegistry([system(name)], async () => {
        await new Promise((r) => setTimeout(r, name === 'A' ? 10 : 1));
        return resolveScopedSystem('team', '1.0.0')?.name;
      }),
    ),
  );
  expect(values).toEqual(['A', 'B']);
  expect(resolveScopedSystem('team', '1.0.0')).toBeUndefined();
});
it('registry cloned so caller mutation does not alter active identity', () => {
  const system = { id: 'team', version: '1.0.0', name: 'A', tokens: {}, fonts: [] };
  withSystemRegistry([system], () => {
    system.name = 'B';
    expect(resolveScopedSystem('team', '1.0.0')?.name).toBe('A');
  });
});
