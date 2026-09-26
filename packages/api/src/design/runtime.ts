import type { Connection } from 'mongoose';
import type { Router } from 'express';
import { startDesignDispatcher, type DesignDispatcher } from './job-dispatcher';
import { createImageGenerationAdapter } from './image-generation-adapter';
import { createDraftGenerationService } from './generation-draft-service';
import { createDraftStreamProvider } from './draft-stream-provider';
import { createGenerationAdapter } from './generation-adapter';
import { createGenerationBudget } from './generation-budget';
import { budgetedProvider } from './budgeted-provider';
import { createDesignRouter } from './http';
import { createDesignStore } from './store';
export interface DesignRuntimeConfig {
  enabled: boolean;
  assetDir?: string;
  presentationTransport?: import('./presenton-adapter').PresentonTransport;
  referenceProvider?: import('./reference-workflow').ReferenceProvider;
  generation?: {
    baseURL: string;
    allowedOrigins: string[];
    model: string;
    imageModel?: string;
    inpaintModel?: string;
    monthlyAllowance: number;
    requestUnits: number;
  };
}
export interface DesignRuntime {
  router: Router;
  stop(): Promise<void>;
}
export async function createDesignRuntime(
  connection: Connection,
  config: DesignRuntimeConfig,
  resolveCredential: (principalId: string) => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): Promise<DesignRuntime> {
  let budget: import('./generation-budget').GenerationBudget | undefined;
  let closed = false;
  let dispatcher: DesignDispatcher | undefined;
  let generationProvider: import('./providers').DesignGenerationProvider | undefined;
  if (config.enabled && config.generation) {
    const g = config.generation;
    budget = await createGenerationBudget({
      connection,
      monthlyAllowance: g.monthlyAllowance,
      requestUnits: g.requestUnits,
    });
    const text = createGenerationAdapter({
      enabled: true,
      baseURL: g.baseURL,
      allowedOrigins: g.allowedOrigins,
      model: g.model,
      resolveCredential,
      fetchImpl,
    });
    const image = g.imageModel
      ? createImageGenerationAdapter({
          enabled: true,
          baseURL: g.baseURL,
          allowedOrigins: g.allowedOrigins,
          model: g.imageModel,
          resolveCredential,
          fetchImpl,
        })
      : undefined;
    const combined: import('./providers').DesignGenerationProvider = {
      capabilities: { textProposal: true, imageGeneration: !!image },
      submit: (input) =>
        input.capability === 'imageGeneration' && image ? image.submit(input) : text.submit(input),
    };
    generationProvider = budgetedProvider(combined, budget);
  }
  const draftService =
    config.enabled && config.generation && budget
      ? await createDraftGenerationService({
          connection,
          store: createDesignStore(connection),
          budget,
          provider: createDraftStreamProvider({
            enabled: true,
            baseURL: config.generation.baseURL,
            allowedOrigins: config.generation.allowedOrigins,
            model: config.generation.model,
            resolveCredential,
            fetchImpl,
          }),
        })
      : undefined;
  const router = createDesignRouter({
    connection,
    enabled: config.enabled,
    assetDir: config.assetDir,
    draftService,
    generationReady: !!generationProvider,
    initializeJobs: true,
    generationProvider,
    checkGenerationBudget: budget ? (input) => budget!.preflight(input.principalId) : undefined,
    onJobServiceReady: (service) => {
      if (!closed && generationProvider && !dispatcher) dispatcher = startDesignDispatcher(service);
    },
  });
  return {
    router,
    async stop() {
      closed = true;
      await dispatcher?.stop();
    },
  };
}
