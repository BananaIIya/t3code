import { assert, it } from "@effect/vitest";
import {
  CommandId,
  OrchestrationV2Command,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";

const adapter = (provider: string) => ({
  instanceId: ProviderInstanceId.make(provider),
  driver: ProviderDriverKind.make(provider),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("This metadata test must never open a provider"),
});
const database = SqlitePersistence.layerMemory;
const harness = ProviderReplayHarness.layerWithRegistry(
  { name: "worker-config" },
  ProviderAdapterRegistry.layerFromAdapters([adapter("claudeAgent"), adapter("codex")]),
  { databaseLayer: database, runEffectWorker: false },
);

const layer = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  harness,
);

it.effect(
  "worker-only commands persist a single route and switch providers on the same thread",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const decode = Schema.decodeUnknownEffect(OrchestrationV2Command);
      const threadId = ThreadId.make("worker:config-test");
      const create = yield* decode({
        type: "thread.create",
        commandId: "worker-create",
        threadId,
        projectId: "worker-project",
        title: "Worker configuration",
        worker: { provider: "claudeAgent", model: "claude-haiku-5-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch(create);
      let thread = yield* store.getThread(threadId);
      assert.deepStrictEqual(thread.worker, { provider: "claudeAgent", model: "claude-haiku-5-5" });
      assert.equal(thread.modelSelection.instanceId, "claudeAgent");
      const update = yield* decode({
        type: "thread.model-selection.set",
        commandId: "worker-switch",
        threadId,
        worker: { provider: "codex", model: "gpt-6-luna" },
      });
      yield* orchestrator.dispatch(update);
      thread = yield* store.getThread(threadId);
      assert.deepStrictEqual(thread.worker, { provider: "codex", model: "gpt-6-luna" });
      assert.equal(thread.providerInstanceId, "codex");
      assert.equal(thread.modelSelection.model, "gpt-6-luna");
      yield* orchestrator.dispatch({
        type: "thread.model-selection.set",
        commandId: CommandId.make("worker-old-selector"),
        threadId,
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-haiku-5-5",
        },
      });
      thread = yield* store.getThread(threadId);
      assert.deepStrictEqual(thread.worker, { provider: "claudeAgent", model: "claude-haiku-5-5" });
    }).pipe(Effect.provide(layer)),
);
