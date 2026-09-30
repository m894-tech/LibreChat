const { EventEmitter } = require('node:events');

const mockEstimateNextRequest = jest.fn();
const mockCleanupMCPRequestContextForReq = jest.fn();
const mockDisposeClient = jest.fn();

jest.mock('@librechat/api', () => ({
  estimateNextRequest: (...args) => mockEstimateNextRequest(...args),
  getSafeErrorMetadata: jest.fn((error) => ({ message: error.message })),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));
jest.mock('~/server/cleanup', () => ({
  disposeClient: (...args) => mockDisposeClient(...args),
}));
jest.mock('~/server/services/MCPRequestContext', () => ({
  cleanupMCPRequestContextForReq: (...args) => mockCleanupMCPRequestContextForReq(...args),
}));

const ContextEstimateController = require('./estimate');

function makeResponse() {
  const response = new EventEmitter();
  response.headersSent = false;
  response.writableEnded = false;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

describe('ContextEstimateController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCleanupMCPRequestContextForReq.mockResolvedValue(undefined);
  });

  it('disposes the initialized client and request-scoped MCP context after success', async () => {
    const req = {
      body: {
        endpointOption: { endpoint: 'openAI' },
        conversationId: 'c1',
        revision: 1,
      },
    };
    const res = makeResponse();
    const client = { id: 'estimate-client' };
    const initializeClient = jest.fn().mockResolvedValue({ client });
    const estimate = { status: 'fresh' };
    mockEstimateNextRequest.mockResolvedValue(estimate);

    await ContextEstimateController(req, res, jest.fn(), initializeClient);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(estimate);
    expect(mockCleanupMCPRequestContextForReq).toHaveBeenCalledWith(req);
    expect(mockDisposeClient).toHaveBeenCalledWith(client);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('cleans request-scoped MCP context when initialization fails', async () => {
    const req = { body: {} };
    const res = makeResponse();
    const initializeClient = jest.fn().mockRejectedValue(new Error('init failed'));

    await ContextEstimateController(req, res, jest.fn(), initializeClient);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockCleanupMCPRequestContextForReq).toHaveBeenCalledWith(req);
    expect(mockDisposeClient).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });
});
