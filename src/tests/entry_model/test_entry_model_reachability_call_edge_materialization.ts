import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import type { SourceRule } from "../../core/rules/RuleSchema";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeFixture(): string {
    const dir = resolveTestRunDir("entry_model", "reachability_call_edge_materialization_fixture");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "main.ets"), `
class WrapperInput {
  static read(value: string): string {
    return value;
  }
}

class WrapperUtility {
  static wrap(value: string): string {
    const wrapped = WrapperInput.read(value);
    return wrapped;
  }
}

class CallbackEmitter {
  static once(seed: string, callback: (payload: string) => void): void {
    callback(seed);
  }
}

class CallbackTask {
  last: string = "";

  register(): void {
    const seed = "callback-payload";
    CallbackEmitter.once(seed, (payload: string) => {
      this.last = payload;
    });
  }
}

class TaskInput {
  static request(value: string): string {
    return value;
  }
}

class TaskWorker {
  execute(value: string): string {
    return TaskInput.request(value);
  }
}

class TaskFactory {
  static create(): TaskWorker {
    return new TaskWorker();
  }
}

class TaskRoot {
  start(value: string): string {
    const worker = TaskFactory.create();
    return worker.execute(value);
  }
}

class InterfaceInput {
  static read(value: string): string {
    return value;
  }
}

class InterfaceNegativeInput {
  static read(value: string): string {
    return value;
  }
}

interface Provider {
  send(value: string): string;
}

class RemoteProvider implements Provider {
  send(value: string): string {
    return InterfaceInput.read(value);
  }
}

class LocalProvider implements Provider {
  send(value: string): string {
    return InterfaceNegativeInput.read(value);
  }
}

class ProviderFactory {
  static create(): Provider {
    return new RemoteProvider();
  }
}

class InterfaceTask {
  run(value: string): string {
    const provider: Provider = ProviderFactory.create();
    return provider.send(value);
  }
}

class AmbiguousInterfaceTask {
  run(provider: Provider, value: string): string {
    return provider.send(value);
  }
}

class UnreachableInput {
  static read(): string {
    return "unreachable";
  }
}

class UnreachableTask {
  run(): string {
    return UnreachableInput.read();
  }
}

@Entry
@Component
struct ReachabilityMaterializationPage {
  token: string = "";

  build(): void {
    this.activate();
  }

  @Builder
  activate(): void {
    const value = "entry";
    this.token = WrapperUtility.wrap(value);
    const callbackTask = new CallbackTask();
    callbackTask.register();
    const taskRoot = new TaskRoot();
    this.token = taskRoot.start(value);
    const interfaceTask = new InterfaceTask();
    this.token = interfaceTask.run(value);
    const ambiguousTask = new AmbiguousInterfaceTask();
    ambiguousTask.run(new RemoteProvider(), value);
  }
}
`, "utf-8");
    return dir;
}

function findMethod(scene: Scene, className: string, methodName: string) {
    const method = scene.getMethods().find(candidate =>
        candidate.getName?.() === methodName
        && candidate.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `missing method ${className}.${methodName}`);
    return method;
}

function methodSignature(scene: Scene, className: string, methodName: string): string {
    return findMethod(scene, className, methodName).getSignature().toString();
}

function sourceRule(
    id: string,
    effect: ReturnType<typeof projectApiEffectAssetFromMethod>,
    sourceKind: SourceRule["sourceKind"],
): SourceRule {
    return {
        id,
        enabled: true,
        match: { kind: "canonical_api_id_equals", value: effect.canonicalApiDescriptor.canonicalApiId },
        apiEffect: effect.apiEffect,
        sourceKind,
        target: "result",
    };
}

async function main(): Promise<void> {
    const scene = buildTestScene(writeFixture());
    const wrapperSource = projectApiEffectAssetFromMethod({
        id: "reachability.wrapper_source",
        role: "source",
        method: findMethod(scene, "WrapperInput", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const callbackSource = projectApiEffectAssetFromMethod({
        id: "reachability.callback_source",
        role: "source",
        method: findMethod(scene, "CallbackEmitter", "once"),
        endpoint: {
            base: {
                kind: "callbackArg",
                callback: { kind: "arg", index: 1 },
                argIndex: 0,
            },
        },
        sourceKind: "callback_param",
    });
    const taskSource = projectApiEffectAssetFromMethod({
        id: "reachability.task_source",
        role: "source",
        method: findMethod(scene, "TaskInput", "request"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const interfaceSource = projectApiEffectAssetFromMethod({
        id: "reachability.interface_source",
        role: "source",
        method: findMethod(scene, "InterfaceInput", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const interfaceNegativeSource = projectApiEffectAssetFromMethod({
        id: "reachability.interface_negative_source",
        role: "source",
        method: findMethod(scene, "InterfaceNegativeInput", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const unreachableSource = projectApiEffectAssetFromMethod({
        id: "reachability.unreachable_source",
        role: "source",
        method: findMethod(scene, "UnreachableInput", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const sourceEntries: Array<[ReturnType<typeof projectApiEffectAssetFromMethod>, SourceRule["sourceKind"]]> = [
        [wrapperSource, "call_return"],
        [callbackSource, "callback_param"],
        [taskSource, "call_return"],
        [interfaceSource, "call_return"],
        [interfaceNegativeSource, "call_return"],
        [unreachableSource, "call_return"],
    ];
    const effects = sourceEntries.map(([effect]) => effect);
    const engine = new TaintPropagationEngine(scene, 1, {
        apiAssets: effects.map(effect => effect.asset),
        canonicalApiRegistry: createCanonicalApiRegistry(effects.map(effect => effect.canonicalApiDescriptor)),
    });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);

    for (const [className, methodName] of [
        ["WrapperUtility", "wrap"],
        ["CallbackTask", "register"],
        ["TaskRoot", "start"],
        ["TaskWorker", "execute"],
        ["InterfaceTask", "run"],
        ["RemoteProvider", "send"],
    ] as const) {
        assert(
            reachable.has(methodSignature(scene, className, methodName)),
            `${className}.${methodName} should be reachable`,
        );
    }
    assert(
        !reachable.has(methodSignature(scene, "LocalProvider", "send")),
        "ambiguous interface dispatch must not make every implementation reachable",
    );
    assert(
        !reachable.has(methodSignature(scene, "UnreachableTask", "run")),
        "unconnected task method must remain unreachable",
    );

    const sourceRules = sourceEntries.map(([effect, kind]) => sourceRule(effect.apiEffect.assetId, effect, kind));
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    for (const effect of [wrapperSource, callbackSource, taskSource, interfaceSource]) {
        assert(
            (seedInfo.sourceRuleHits[effect.apiEffect.assetId] || 0) > 0,
            `${effect.apiEffect.assetId} should seed from reachable exact call edge`,
        );
    }
    for (const effect of [interfaceNegativeSource, unreachableSource]) {
        assert(
            !seedInfo.sourceRuleHits[effect.apiEffect.assetId],
            `${effect.apiEffect.assetId} should not seed outside reachable exact chain`,
        );
    }
    const negativeAudit = seedInfo.sourceRuleZeroHitAudit.find(entry => entry.ruleId === interfaceNegativeSource.apiEffect.assetId);
    assert(negativeAudit?.reason === "source_rule_callsite_outside_allowed_methods", "interface negative source should report outside allowed methods");
    const sample = negativeAudit.sampleCallsites[0];
    assert(sample?.effectSiteId, "zero-hit sample should include effectSiteId");
    assert(sample?.occurrenceId, "zero-hit sample should include occurrenceId");
    assert(sample?.reachableGapChain?.reason === "accepted_source_site_method_not_in_allowed_reachable_fixed_point", "zero-hit sample should include reachability chain");

    const ledger = engine.getCallEdgeMaterializationLedger();
    assert(ledger.length > 0, "call edge materialization ledger should not be empty");
    assert(
        ledger.some(record => record.edgeKind === "callback_registration" && record.status === "built"),
        "callback registration edge should be materialized and recorded",
    );
    assert(
        ledger.some(record =>
            record.calleeSignature?.includes("RemoteProvider.send")
            && record.calleeResolveReason === "interface_dispatch"
            && record.status === "built"
        ),
        "interface dispatch to the concrete factory-return receiver should be built and recorded",
    );
    assert(
        !ledger.some(record =>
            record.calleeSignature?.includes("LocalProvider.send")
            && record.status === "built"
        ),
        "call edge ledger must not record a built edge to the unrelated interface implementation",
    );
    assert(
        ledger.some(record =>
            record.reason === "virtual_dispatch_unresolved"
            && (record.evidence || []).includes("missing_concrete_receiver_owner")
        ),
        "ambiguous interface dispatch should be recorded with a concrete missing-owner reason",
    );

    console.log("PASS test_entry_model_reachability_call_edge_materialization");
}

main().catch(error => {
    console.error("FAIL test_entry_model_reachability_call_edge_materialization");
    console.error(error);
    process.exit(1);
});
