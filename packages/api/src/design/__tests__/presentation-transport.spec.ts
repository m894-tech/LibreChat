import { createPresentationTransport } from '../presentation-transport';
it('uses only per-user bearer and allowed routes', async () => {
  const fetchImpl = jest.fn(async () => new Response('{"revision":1}'));
  const resolveCredential = jest.fn(async () => 'synthetic');
  const transport = createPresentationTransport({
    baseURL: 'https://slides.example',
    allowedOrigins: ['https://slides.example'],
    resolveCredential,
    fetchImpl,
  });
  await transport.request('user', '/api/v1/ppt/editor/v1/documents/abc/snapshot', {
    method: 'GET',
    signal: new AbortController().signal,
  });
  expect(resolveCredential).toHaveBeenCalledWith('user');
  expect(fetchImpl.mock.calls[0][0]).toBe(
    'https://slides.example/api/v1/ppt/editor/v1/documents/abc/snapshot',
  );
  await expect(
    transport.request('user', '/api/admin/delete', {
      method: 'POST',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('missing key makes no remote request', async () => {
  const fetchImpl = jest.fn();
  await expect(
    createPresentationTransport({
      baseURL: 'https://slides.example',
      allowedOrigins: ['https://slides.example'],
      resolveCredential: async () => null,
      fetchImpl,
    }).request('u', '/api/v1/ppt/images/upload', {
      method: 'POST',
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(fetchImpl).not.toHaveBeenCalled();
});
