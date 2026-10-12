import { ProviderDriverKind, TextGenerationError, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ProviderAdapterOpenSessionError } from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderDriver } from "@t3tools/provider-core/server/driver";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { NebiusSettings } from "../nebiusSettings.ts";
import { NEBIUS_MODELS, nebiusOpenCodeConfiguration } from "../nebiusModels.ts";
import { makeOpenCodeDriver, type OpenCodeDriverEnv } from "./driver.ts";

const driverKind = ProviderDriverKind.make("nebius");
const decodeNebiusSettings = Schema.decodeSync(NebiusSettings);
const openCode = makeOpenCodeDriver(driverKind);
const openCodeConfiguration = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(
  nebiusOpenCodeConfiguration(),
);
const builtInModelSlugs = new Set<string>(NEBIUS_MODELS.map((model) => `nebius/${model.id}`));
// OpenCode accepts these as custom models; T3 must publish them as this driver's built-in catalog.
const withBuiltInModels = <T extends ServerProvider>(snapshot: T): T => ({
  ...snapshot,
  models: snapshot.models.map((model) =>
    builtInModelSlugs.has(model.slug) ? { ...model, isCustom: false } : model,
  ),
});

const disabledGeneration = Effect.fail(
  new TextGenerationError({
    operation: "nebius",
    detail: "Enable Nebius and configure its API key before running inference.",
  }),
);
const unavailableTextGeneration: ProviderTextGeneration = {
  generateCommitMessage: () => disabledGeneration,
  generatePrContent: () => disabledGeneration,
  generateBranchName: () => disabledGeneration,
  generateThreadTitle: () => disabledGeneration,
  generateReviewGuide: () => disabledGeneration,
};

export const NebiusDriver: ProviderDriver<NebiusSettings, OpenCodeDriverEnv> = {
  driverKind,
  metadata: { displayName: "Nebius · OpenCode", supportsMultipleInstances: true },
  configSchema: NebiusSettings,
  defaultConfig: () => decodeNebiusSettings({}),
  create: (input) =>
    Effect.gen(function* () {
      const { apiKey, ...settings } = input.config;
      // Disabled instances receive neither a credential nor a custom OpenCode config.
      const environment = input.enabled
        ? [
            ...input.environment.filter(
              (variable) =>
                ![
                  "NEBIUS_API_KEY",
                  "OPENCODE_CONFIG_CONTENT",
                  "OPENCODE_DISABLE_MODELS_FETCH",
                ].includes(variable.name),
            ),
            { name: "NEBIUS_API_KEY", value: apiKey, sensitive: true },
            {
              name: "OPENCODE_CONFIG_CONTENT",
              value: openCodeConfiguration,
              sensitive: false,
            },
            { name: "OPENCODE_DISABLE_MODELS_FETCH", value: "true", sensitive: false },
          ]
        : [];
      const instance = yield* openCode.create({
        ...input,
        displayName: input.displayName ?? "Nebius · OpenCode",
        environment,
        config: {
          ...openCode.defaultConfig(),
          ...settings,
          enabled: input.enabled,
          customModels: NEBIUS_MODELS.map((model) => ({
            slug: `nebius/${model.id}`,
            name: model.name,
            capabilities: { optionDescriptors: [] },
          })),
        },
      });
      const canRun = input.enabled && apiKey.length > 0;
      return {
        ...instance,
        snapshot: {
          ...instance.snapshot,
          getSnapshot: instance.snapshot.getSnapshot.pipe(Effect.map(withBuiltInModels)),
          refresh: instance.snapshot.refresh.pipe(Effect.map(withBuiltInModels)),
          streamChanges: instance.snapshot.streamChanges.pipe(Stream.map(withBuiltInModels)),
        },
        ...(instance.snapshotForCwd
          ? {
              snapshotForCwd: (cwd: string) =>
                instance.snapshotForCwd!(cwd).pipe(Effect.map(withBuiltInModels)),
            }
          : {}),
        // The registry also rejects disabled instances; enforce the gate at the adapter boundary.
        orchestrationAdapter: {
          ...instance.orchestrationAdapter,
          openSession: (request) =>
            canRun
              ? instance.orchestrationAdapter.openSession(request)
              : Effect.fail(
                  new ProviderAdapterOpenSessionError({
                    driver: driverKind,
                    providerSessionId: request.providerSessionId,
                  }),
                ),
        },
        textGeneration: canRun ? instance.textGeneration : unavailableTextGeneration,
      };
    }),
};
