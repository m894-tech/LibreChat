import { z } from 'zod';
import type { DesignPrincipal } from './assets';
import { DesignError } from './assets';

export type DesignCapability = 'imageGeneration' | 'textProposal';

export interface DesignProviderCapabilities {
  imageGeneration: boolean;
  textProposal: boolean;
}

export class ProviderUncertainError extends Error {
  readonly uncertain = true as const;
  constructor(message = 'Provider submission state is unknown') {
    super(message);
    this.name = 'ProviderUncertainError';
  }
}

export interface ProviderSubmitInput {
  jobId: string;
  principalId: string;
  projectId: string;
  documentId: string;
  capability: DesignCapability;
  payload: Record<string, unknown>;
}

export type ProviderSubmitResult =
  | { kind: 'accepted'; providerJobId: string }
  | {
      kind: 'immediate';
      providerJobId?: string;
      proposal?: unknown;
      imageBytes?: Buffer;
      mime?: string;
      filename?: string;
    };

export interface ProviderStatusResult {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  proposal?: unknown;
  imageBytes?: Buffer;
  mime?: string;
  filename?: string;
  error?: { code: string; message: string };
}

/**
 * Fully injectable generation backend.
 *
 * R1 does not ship a working paid image generator. Inject
 * `UnavailableProvider` or a test double. `status` is optional; when
 * omitted, async jobs can only complete via an immediate submit result.
 */
export interface DesignGenerationProvider {
  readonly capabilities: DesignProviderCapabilities;
  submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult>;
  status?(providerJobId: string): Promise<ProviderStatusResult>;
}

export const UnavailableProvider: DesignGenerationProvider = {
  capabilities: {
    imageGeneration: false,
    textProposal: false,
  },
  async submit(): Promise<ProviderSubmitResult> {
    throw new DesignError(
      422,
      'CAPABILITY_UNAVAILABLE',
      'Design generation provider is unavailable',
    );
  },
};

export function createUnavailableProvider(): DesignGenerationProvider {
  return UnavailableProvider;
}

const OPERATION_TYPES = [
  'setProperty',
  'setText',
  'insertNode',
  'removeNode',
  'moveNode',
  'reorderNode',
  'replaceAsset',
  'bindToken',
  'setLiteral',
  'applySystem',
  'lock',
  'unlock',
] as const;

const proposalOperationSchema = z
  .object({
    type: z.enum(OPERATION_TYPES),
    nodeId: z.string().min(1).max(128).optional(),
    parentId: z.string().min(1).max(128).nullable().optional(),
    property: z.string().min(1).max(64).optional(),
    value: z.unknown().optional(),
    node: z.record(z.unknown()).optional(),
    assetId: z.string().min(1).max(64).optional(),
    assetVersion: z.number().int().positive().optional(),
    systemId: z.string().min(1).max(64).optional(),
    systemVersion: z.string().min(1).max(64).optional(),
    preserveOverrides: z.boolean().optional(),
  })
  .strict();

const designProposalSchema: z.ZodType<DesignProposal> = z
  .object({
    kind: z.literal('design_proposal'),
    schemaVersion: z.literal(1),
    title: z.string().max(200).optional(),
    operations: z.array(proposalOperationSchema).max(200),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export interface DesignProposal {
  kind: 'design_proposal';
  schemaVersion: 1;
  title?: string;
  notes?: string;
  operations: Array<{
    type: (typeof OPERATION_TYPES)[number];
    nodeId?: string;
    parentId?: string | null;
    property?: string;
    value?: unknown;
    node?: Record<string, unknown>;
    assetId?: string;
    assetVersion?: number;
    systemId?: string;
    systemVersion?: string;
    preserveOverrides?: boolean;
  }>;
}

const DISALLOWED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'eval',
  'script',
  'function',
  'code',
  'executable',
]);

function assertSafeJson(value: unknown, pathLabel = 'proposal'): void {
  if (typeof value === 'function') {
    throw new DesignError(422, 'VALIDATION', `${pathLabel} must not contain functions`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeJson(entry, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (DISALLOWED_KEYS.has(key) || key.startsWith('__')) {
        throw new DesignError(422, 'VALIDATION', `${pathLabel} contains a disallowed key`);
      }
      assertSafeJson(nested, `${pathLabel}.${key}`);
    }
  }
}

export function parseDesignProposal(raw: unknown): DesignProposal {
  let value = raw;
  if (typeof raw === 'string') {
    let text = raw.trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) text = fence[1].trim();
    try {
      value = JSON.parse(text);
    } catch {
      throw new DesignError(422, 'VALIDATION', 'Proposal is not valid JSON');
    }
  }
  assertSafeJson(value);
  const parsed = designProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw new DesignError(422, 'VALIDATION', 'Proposal does not match the design schema');
  }
  return parsed.data;
}

export interface StructuredTextCompleteInput {
  prompt: string;
  schema: Record<string, unknown>;
}

/**
 * Injected completion function only. No API keys, no network, no eval.
 * The function must return JSON or a JSON string matching `designProposalSchema`.
 */
export type StructuredTextComplete = (input: StructuredTextCompleteInput) => Promise<unknown>;

const PROPOSAL_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'schemaVersion', 'operations'],
  properties: {
    kind: { const: 'design_proposal' },
    schemaVersion: { const: 1 },
    title: { type: 'string', maxLength: 200 },
    notes: { type: 'string', maxLength: 2000 },
    operations: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { enum: [...OPERATION_TYPES] },
          nodeId: { type: 'string' },
          parentId: { type: ['string', 'null'] },
          property: { type: 'string' },
          value: {},
          node: { type: 'object' },
          assetId: { type: 'string' },
          assetVersion: { type: 'integer' },
          systemId: { type: 'string' },
          systemVersion: { type: 'integer' },
          preserveOverrides: { type: 'boolean' },
        },
      },
    },
  },
};

/**
 * Structured text-provider adapter around an already-injected `complete`
 * function. It never holds service keys, never fetches URLs, and never
 * executes proposal data as code.
 */
export function createStructuredTextProvider(options: {
  complete: StructuredTextComplete;
}): DesignGenerationProvider {
  if (typeof options?.complete !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'complete function is required');
  }
  const complete = options.complete;

  return {
    capabilities: {
      imageGeneration: false,
      textProposal: true,
    },
    async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
      if (input.capability !== 'textProposal') {
        throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Image generation is unavailable');
      }
      const prompt = typeof input.payload.prompt === 'string' ? input.payload.prompt : '';
      if (!prompt.trim()) {
        throw new DesignError(422, 'VALIDATION', 'prompt is required');
      }
      const raw = await complete({ prompt, schema: PROPOSAL_JSON_SCHEMA });
      const proposal = parseDesignProposal(raw);
      return {
        kind: 'immediate',
        providerJobId: `text:${input.jobId}`,
        proposal,
      };
    },
  };
}

export function isUncertainProviderError(error: unknown): boolean {
  if (error instanceof ProviderUncertainError) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { uncertain?: unknown; code?: unknown; name?: unknown };
  if (candidate.uncertain === true) {
    return true;
  }
  if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') {
    return true;
  }
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET'
  );
}

export type { DesignPrincipal };
