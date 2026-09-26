import { request } from 'librechat-data-provider';
import { designApi } from '../api';
jest.mock('librechat-data-provider', () => ({ request: { get: jest.fn() } }));
it('shows only explicitly configured generation capabilities', async () => {
  (request.get as jest.Mock).mockResolvedValue({
    textPrompt: true,
    textProposal: true,
    imageGeneration: false,
    imageGenerate: false,
    imageUpload: true,
    exports: ['source', 'png-client'],
  });
  const c = await designApi.probeCapabilities();
  expect(c.textPrompt).toBe(true);
  expect(c.imageGenerate).toBe(false);
});
it('does not infer generation from missing capability metadata', async () => {
  (request.get as jest.Mock).mockResolvedValue({});
  const c = await designApi.probeCapabilities();
  expect(c.textPrompt).toBe(false);
  expect(c.imageGenerate).toBe(false);
});
