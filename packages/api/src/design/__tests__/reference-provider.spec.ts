import { createReferenceProvider } from '../reference-provider';
it('passes exact actor/tool/arguments to authorized transport and returns metadata only', async () => {
  const call = jest.fn(async () => ({
    results: [
      { id: '1', title: 'Reference', url: 'https://example.org', screenshot: 'not redistributed' },
    ],
  }));
  const result = await createReferenceProvider({ call }).search('user1', 'styles', 'Editorial');
  expect(call).toHaveBeenCalledWith(
    'user1',
    'refero_search_styles',
    { query: 'Editorial', page: 1, response_format: 'json' },
    expect.any(AbortSignal),
  );
  expect(result).toEqual([
    { id: '1', kind: 'styles', title: 'Reference', url: 'https://example.org/' },
  ]);
});
it('rejects protocol and unknown provider shape, never invents result', async () => {
  await expect(
    createReferenceProvider({
      call: async () => ({ results: [{ id: '1', title: 'bad', url: 'javascript:alert(1)' }] }),
    }).search('u', 'screens', 'x'),
  ).rejects.toThrow();
  await expect(
    createReferenceProvider({ call: async () => ({ html: 'not json' }) }).search(
      'u',
      'styles',
      'x',
    ),
  ).rejects.toThrow();
});
