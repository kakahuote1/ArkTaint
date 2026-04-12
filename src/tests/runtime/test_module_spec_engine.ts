import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type {
    ModuleSemanticSurfaceRef,
    ModuleSpec,
} from "../../core/kernel/contracts/ModuleSpec";
import { compileModuleSpec } from "../../core/orchestration/modules/ModuleSpecCompiler";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function hasLoweredModule(loadedModuleIds: string[], specId: string): boolean {
    return loadedModuleIds.some(id => id === specId || id.startsWith(`${specId}::`));
}

function expectCompileError(spec: unknown, expectedSubstrings: string[]): void {
    let message = "";
    try {
        compileModuleSpec(spec as ModuleSpec);
        assert(false, "expected compileModuleSpec to fail");
    } catch (error) {
        message = String((error as any)?.message || error);
    }
    for (const expected of expectedSubstrings) {
        assert(
            message.includes(expected),
            `expected compile error to include ${JSON.stringify(expected)}, got: ${message}`,
        );
    }
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function runCase(
    scene: Scene,
    relativePath: string,
    caseName: string,
    options: {
        moduleSpecs?: ModuleSpec[];
        moduleSpecFiles?: string[];
    },
): Promise<{
    totalFlows: number;
    loadedModuleIds: string[];
    deferredContractCount: number;
}> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath: path.resolve(resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "project.rules.json")),
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });
    const sourceRules = loaded.ruleSet.sources || [];
    const sinkRules = loaded.ruleSet.sinks || [];
    const entry = resolveCaseMethod(scene, relativePath, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `missing entry method: ${caseName}`);

    const engine = new TaintPropagationEngine(scene, 1, {
        includeBuiltinModules: false,
        moduleSpecs: options.moduleSpecs,
        moduleSpecFiles: options.moduleSpecFiles,
    });
    engine.verbose = false;
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    try {
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const audit = engine.getModuleAuditSnapshot();
    const deferredCount = engine.getExecutionHandoffContractSnapshot()?.totalContracts || 0;
    return {
        totalFlows: flows.length,
        loadedModuleIds: audit.loadedModuleIds,
        deferredContractCount: deferredCount,
    };
}

function invoke(selector: {
    methodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    minArgs?: number;
    instanceOnly?: boolean;
    staticOnly?: boolean;
}): ModuleSemanticSurfaceRef {
    return {
        kind: "invoke",
        selector,
    };
}

function method(selector: {
    methodSignature?: string;
    methodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
}): ModuleSemanticSurfaceRef {
    return {
        kind: "method",
        selector,
    };
}

function arg(surface: ModuleSemanticSurfaceRef | string, index: number, fieldPath?: string[]) {
    return {
        surface,
        slot: "arg" as const,
        index,
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function result(surface: ModuleSemanticSurfaceRef | string, fieldPath?: string[]) {
    return {
        surface,
        slot: "result" as const,
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function callbackParam(surface: ModuleSemanticSurfaceRef | string, callbackArgIndex?: number, paramIndex?: number, fieldPath?: string[]) {
    return {
        surface,
        slot: "callback_param" as const,
        ...(callbackArgIndex !== undefined ? { callbackArgIndex } : {}),
        ...(paramIndex !== undefined ? { paramIndex } : {}),
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function methodThis(surface: ModuleSemanticSurfaceRef) {
    return {
        surface,
        slot: "method_this" as const,
    };
}

function methodParam(surface: ModuleSemanticSurfaceRef, paramIndex: number, fieldPath?: string[]) {
    return {
        surface,
        slot: "method_param" as const,
        paramIndex,
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function fieldLoad(surface: ModuleSemanticSurfaceRef, fieldName: string, baseThisOnly = true) {
    return {
        surface,
        slot: "field_load" as const,
        fieldName,
        baseThisOnly,
    };
}

function mainEmit(reason: string, boundary?: "identity" | "serialized_copy" | "clone_copy" | "stringify_result") {
    return {
        reason,
        allowUnreachableTarget: true,
        ...(boundary ? { boundary } : {}),
    };
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_spec_engine");
    const repoRoot = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "repo");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const projectRulePath = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "project.rules.json");
    const callbackSpecFile = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "callback_spec.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    writeText(
        path.join(sourceDir, "callback_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Register(value: string, callback: (observed: string) => void): void {}",
            "function Sink(v: string): void {}",
            "",
            "function callback_case(): void {",
            "  const value = Source();",
            "  Register(value, (observed: string) => {",
            "    Sink(observed);",
            "  });",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "carrier_case.ets"),
        [
            "class Bus {",
            "  onMessage(callback: (payload: string) => void): void {}",
            "  postMessage(value: string): void {}",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "function carrier_case(): void {",
            "  const bus = new Bus();",
            "  bus.onMessage((payload: string) => {",
            "    Sink(payload);",
            "  });",
            "  bus.postMessage(Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "emitter_scope_case.ets"),
        [
            "class EventBusA {",
            "  on(topic: string, callback: (payload: string) => void): void {}",
            "  emit(topic: string, payload: string): void {}",
            "}",
            "",
            "class EventBusB {",
            "  on(topic: string, callback: (payload: string) => void): void {}",
            "  emit(topic: string, payload: string): void {}",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function emitter_scope_case(): void {",
            "  const busA = new EventBusA();",
            "  const busB = new EventBusB();",
            "  busA.on(\"ready\", (payload: string) => {",
            "    Sink(payload);",
            "  });",
            "  busB.emit(\"ready\", Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "keyed_state_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Put(key: string, value: string): void {}",
            "function Get(key: string): string {",
            "  return \"clean\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function keyed_state_case(): void {",
            "  Put(\"session\", Source());",
            "  const observed = Get(\"session\");",
            "  Sink(observed);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "same_address_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function PutAddress(key: string, value: string): void {}",
            "function GetAddress(key: string): string {",
            "  return \"clean\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function same_address_case(): void {",
            "  PutAddress(\"token\", Source());",
            "  const observed = GetAddress(\"token\");",
            "  Sink(observed);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "method_field_state_case.ets"),
        [
            "class Lifecycle020 {",
            "  saved: string = \"\";",
            "",
            "  onCreate(want: string): void {}",
            "",
            "  render(): void {",
            "    Sink(this.saved);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function method_field_state_case(): void {",
            "  const page = new Lifecycle020();",
            "  page.onCreate(Source());",
            "  page.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "declarative_case.ets"),
        [
            "class WatchBox {",
            "  token: string = \"\";",
            "",
            "  setToken(value: string): void {",
            "    this.token = value;",
            "  }",
            "",
            "  onTokenChanged(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function declarative_case(): void {",
            "  const box = new WatchBox();",
            "  box.setToken(Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "method_param_case.ets"),
        [
            "class AbilityContext {",
            "  startAbility(want: string): void {}",
            "}",
            "",
            "class DemoAbility {",
            "  onCreate(want: string): void {",
            "    Sink(want);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function method_param_case(): void {",
            "  const context = new AbilityContext();",
            "  const ability = new DemoAbility();",
            "  context.startAbility(Source());",
            "  ability.onCreate(\"clean\");",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "emitter_case.ets"),
        [
            "class EventBus {",
            "  on(topic: string, callback: (payload: string) => void): void {}",
            "  emit(topic: string, payload: string): void {}",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function emitter_case(): void {",
            "  const bus = new EventBus();",
            "  bus.on(\"ready\", (payload: string) => {",
            "    Sink(payload);",
            "  });",
            "  bus.emit(\"ready\", Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "router_unwrap_case.ets"),
        [
            "class RoutePushParams {",
            "  secret: string = \"\";",
            "}",
            "",
            "class RoutePushOptions {",
            "  route: string = \"\";",
            "  params: RoutePushParams = new RoutePushParams();",
            "}",
            "",
            "class RouteResultParams {",
            "  secret: string = \"\";",
            "}",
            "",
            "class RouterLike {",
            "  static pushRouteWrapped(options: RoutePushOptions): void {}",
            "  static getRouteParams(): RouteResultParams {",
            "    return new RouteResultParams();",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function router_unwrap_case(): void {",
            "  const options = new RoutePushOptions();",
            "  options.route = \"home\";",
            "  options.params.secret = Source();",
            "  RouterLike.pushRouteWrapped(options);",
            "  const params = RouterLike.getRouteParams();",
            "  Sink(params.secret);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "storage_prop_case.ets"),
        [
            "function StorageProp(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "",
            "class StorageHubProp {",
            "  static putValue(key: string, value: string): void {}",
            "}",
            "",
            "class StorageView006 {",
            "  @StorageProp(\"token\")",
            "  token: string = \"\";",
            "",
            "  render(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function storage_prop_case(): void {",
            "  StorageHubProp.putValue(\"token\", Source());",
            "  const view = new StorageView006();",
            "  view.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "storage_prop_mismatch_case.ets"),
        [
            "function StorageProp(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "",
            "class StorageHubPropMismatch {",
            "  static putValue(key: string, value: string): void {}",
            "}",
            "",
            "class StorageView007 {",
            "  @StorageProp(\"safe\")",
            "  token: string = \"\";",
            "",
            "  render(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function storage_prop_mismatch_case(): void {",
            "  StorageHubPropMismatch.putValue(\"token\", Source());",
            "  const view = new StorageView007();",
            "  view.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "provide_consume_case.ets"),
        [
            "function Provide(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "function Consume(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "",
            "class Provider009 {",
            "  @Provide(\"token\")",
            "  token: string = \"\";",
            "",
            "  update(v: string): void {",
            "    this.token = v;",
            "  }",
            "}",
            "",
            "class Consumer009 {",
            "  @Consume(\"token\")",
            "  token: string = \"\";",
            "",
            "  render(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function provide_consume_case(): void {",
            "  const provider = new Provider009();",
            "  const consumer = new Consumer009();",
            "  provider.update(Source());",
            "  consumer.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "container_map_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "function container_map_case(): void {",
            "  const cache = new Map<string, string>();",
            "  cache.set(\"token\", Source());",
            "  const value = cache.get(\"token\");",
            "  Sink(value);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "stringify_boundary_case.ets"),
        [
            "class StringifyPayload013 {",
            "  token: string = \"\";",
            "}",
            "",
            "function JsonStringify013(value: StringifyPayload013): string {",
            "  return \"clean\";",
            "}",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function stringify_boundary_case(): void {",
            "  const payload = new StringifyPayload013();",
            "  payload.token = Source();",
            "  const out = JsonStringify013(payload);",
            "  Sink(out);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "clone_copy_boundary_case.ets"),
        [
            "class CloneSource014 {",
            "  token: string = \"\";",
            "}",
            "",
            "class CloneTarget014 {",
            "  token: string = \"\";",
            "}",
            "",
            "function SaveClone014(value: CloneSource014): void {}",
            "function LoadClone014(): CloneTarget014 {",
            "  return new CloneTarget014();",
            "}",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function clone_copy_boundary_case(): void {",
            "  const payload = new CloneSource014();",
            "  payload.token = Source();",
            "  SaveClone014(payload);",
            "  const out = LoadClone014();",
            "  Sink(out.token);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        projectRulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.module_spec",
                    sourceKind: "call_return",
                    match: {
                        kind: "method_name_equals",
                        value: "Source",
                    },
                    target: "result",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.module_spec",
                    match: {
                        kind: "method_name_equals",
                        value: "Sink",
                    },
                    target: "arg0",
                },
            ],
            sanitizers: [],
            transfers: [],
        }, null, 2),
    );

    const callbackSpec: ModuleSpec = {
        id: "fixture.spec.callback_bridge",
        semantics: [
            {
                kind: "bridge",
                from: arg("Register", 0),
                to: callbackParam("Register", 1),
                emit: {
                    allowUnreachableTarget: true,
                },
            },
        ],
    };
    writeText(callbackSpecFile, JSON.stringify(callbackSpec, null, 2));

    const carrierSpec: ModuleSpec = {
        id: "fixture.spec.same_receiver_callback",
        description: "Bridge bus.postMessage(value) into bus.onMessage(callback) on the same receiver.",
        semantics: [
            {
                id: "bus_callback",
                kind: "bridge",
                from: arg(invoke({ methodName: "postMessage", instanceOnly: true, minArgs: 1 }), 0),
                to: callbackParam(invoke({ methodName: "onMessage", instanceOnly: true, minArgs: 1 }), 0, 0),
                constraints: [
                    {
                        kind: "same_receiver",
                    },
                ],
                dispatch: {
                    preset: "callback_event",
                    reason: "Fixture-SameReceiver",
                },
                emit: mainEmit("Fixture-SameReceiver"),
            },
        ],
    };

    const keyedStateSpec: ModuleSpec = {
        id: "fixture.spec.keyed_state",
        description: "Bridge Put(key, value) into Get(key) via keyed state.",
        semantics: [
            {
                id: "keyed_state",
                kind: "state",
                cell: {
                    kind: "keyed_state",
                    label: "fixture.keyed_state",
                },
                writes: [
                    {
                        from: arg(invoke({ methodName: "Put", minArgs: 2 }), 1),
                        address: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "Put", minArgs: 2 }), 0),
                        },
                        emit: mainEmit("Fixture-KeyedState"),
                    },
                ],
                reads: [
                    {
                        to: result(invoke({ methodName: "Get", minArgs: 1 })),
                        address: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "Get", minArgs: 1 }), 0),
                        },
                        emit: mainEmit("Fixture-KeyedState"),
                    },
                ],
            },
        ],
    };

    const sameAddressSpec: ModuleSpec = {
        id: "fixture.spec.same_address_bridge",
        description: "Bridge PutAddress(key, value) into GetAddress(key) using bridge-level same_address.",
        semantics: [
            {
                id: "same_address",
                kind: "bridge",
                from: arg(invoke({ methodName: "PutAddress", minArgs: 2 }), 1),
                to: result(invoke({ methodName: "GetAddress", minArgs: 1 })),
                constraints: [
                    {
                        kind: "same_address",
                        left: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "PutAddress", minArgs: 2 }), 0),
                        },
                        right: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "GetAddress", minArgs: 1 }), 0),
                        },
                    },
                ],
                emit: mainEmit("Fixture-SameAddress"),
            },
        ],
    };

    const methodFieldStateSpec: ModuleSpec = {
        id: "fixture.spec.method_field_state",
        description: "Persist Lifecycle020.onCreate(want) into this.saved and read it in render().",
        semantics: [
            {
                id: "lifecycle_state",
                kind: "state",
                cell: {
                    kind: "field",
                    carrier: methodThis(method({ declaringClassName: "Lifecycle020", methodName: "onCreate" })),
                    fieldPath: ["saved"],
                },
                writes: [
                    {
                        from: methodParam(method({ declaringClassName: "Lifecycle020", methodName: "onCreate" }), 0),
                        emit: mainEmit("Fixture-MethodFieldState"),
                    },
                ],
                reads: [
                    {
                        to: fieldLoad(method({ declaringClassName: "Lifecycle020", methodName: "render" }), "saved", true),
                        emit: mainEmit("Fixture-MethodFieldState"),
                    },
                ],
            },
        ],
    };

    const declarativeSpec: ModuleSpec = {
        id: "fixture.spec.declarative_binding",
        description: "Trigger onTokenChanged after setToken.",
        semantics: [
            {
                id: "watchbox_binding",
                kind: "declarative_binding",
                source: method({ declaringClassName: "WatchBox", methodName: "setToken" }),
                handler: method({ declaringClassName: "WatchBox", methodName: "onTokenChanged" }),
                triggerLabel: "WatchBox#token",
                dispatch: {
                    preset: "declarative_field",
                    reason: "Fixture-Declarative",
                },
            },
        ],
    };

    const abilitySpec: ModuleSpec = {
        id: "fixture.spec.ability_handoff",
        description: "Bridge startAbility(want) into DemoAbility.onCreate(want).",
        semantics: [
            {
                kind: "bridge",
                from: arg(invoke({ methodName: "startAbility" }), 0),
                to: methodParam(method({ methodName: "onCreate" }), 0),
                emit: {
                    allowUnreachableTarget: true,
                },
            },
        ],
    };

    const emitterSpec: ModuleSpec = {
        id: "fixture.spec.event_emitter",
        description: "Bridge emit(topic, payload) into on(topic, callback).",
        semantics: [
            {
                id: "event_emitter",
                kind: "event_emitter",
                onMethods: ["on"],
                emitMethods: ["emit"],
                payloadArgIndex: 1,
                callbackArgIndex: 1,
                callbackParamIndex: 0,
                maxCandidates: 8,
            },
        ],
    };

    const routerSpec: ModuleSpec = {
        id: "fixture.spec.route_bridge",
        description: "Bridge pushRouteWrapped(options.route/options.params.*) into getRouteParams().*.",
        semantics: [
            {
                id: "route_bridge",
                kind: "route_bridge",
                pushMethods: [
                    {
                        methodName: "pushRouteWrapped",
                        routeField: "route",
                    },
                ],
                getMethods: ["getRouteParams"],
                payloadUnwrapPrefixes: ["params"],
            },
        ],
    };

    const storagePropSpec: ModuleSpec = {
        id: "fixture.spec.keyed_storage",
        description: "Bridge StorageHubProp.putValue(key, value) into @StorageProp field reads.",
        semantics: [
            {
                kind: "keyed_storage",
                storageClasses: ["StorageHubProp", "StorageHubPropMismatch"],
                writeMethods: [
                    { methodName: "putValue", valueIndex: 1 },
                ],
                readMethods: ["fetchValue"],
                propDecorators: ["StorageProp"],
                linkDecorators: [],
            },
        ],
    };

    const provideConsumeSpec: ModuleSpec = {
        id: "fixture.spec.state_binding",
        description: "Bridge @Provide fields into @Consume fields.",
        semantics: [
            {
                id: "provide_consume",
                kind: "state_binding",
                stateDecorators: ["State"],
                propDecorators: ["Prop", "Link", "ObjectLink", "Local", "Param", "Once", "Event", "Trace"],
                linkDecorators: ["Link", "ObjectLink", "Local", "Trace"],
                provideDecorators: ["Provide"],
                consumeDecorators: ["Consume"],
                eventDecorators: ["Event"],
            },
        ],
    };

    const containerSpec: ModuleSpec = {
        id: "fixture.spec.container",
        description: "Enable map-family container storage/load semantics.",
        semantics: [
            {
                id: "map_container",
                kind: "container",
                families: ["map"],
                capabilities: ["store", "load"],
            },
        ],
    };

    const stringifyBoundarySpec: ModuleSpec = {
        id: "fixture.spec.stringify_boundary",
        description: "Project payload.token into stringify result.",
        semantics: [
            {
                id: "stringify_bridge",
                kind: "bridge",
                from: arg(invoke({ methodName: "JsonStringify013", minArgs: 1 }), 0, ["token"]),
                to: result(invoke({ methodName: "JsonStringify013", minArgs: 1 })),
                emit: mainEmit("Fixture-StringifyBoundary", "stringify_result"),
            },
        ],
    };

    const cloneCopyBoundarySpec: ModuleSpec = {
        id: "fixture.spec.clone_copy_boundary",
        description: "Bridge SaveClone014(value) into LoadClone014() with clone-copy semantics.",
        semantics: [
            {
                id: "clone_copy",
                kind: "state",
                cell: {
                    kind: "keyed_state",
                    label: "fixture.clone_copy",
                },
                writes: [
                    {
                        from: arg(invoke({ methodName: "SaveClone014", minArgs: 1 }), 0),
                        address: {
                            kind: "literal",
                            value: "clone_slot",
                        },
                        emit: mainEmit("Fixture-CloneCopy", "clone_copy"),
                    },
                ],
                reads: [
                    {
                        to: result(invoke({ methodName: "LoadClone014", minArgs: 0 })),
                        address: {
                            kind: "literal",
                            value: "clone_slot",
                        },
                        emit: mainEmit("Fixture-CloneCopy", "clone_copy"),
                    },
                ],
            },
        ],
    };

    const invalidSpec = {
        id: "fixture.spec.invalid",
        description: "invalid spec for validation coverage",
        semantics: [
            {
                id: "broken_bridge",
                kind: "bridge",
                from: {
                    surface: {
                        kind: "invoke_surface",
                        selector: {
                            methodName: "postMessage",
                        },
                    },
                    slot: "argument",
                    index: 0,
                },
                to: {
                    surface: {
                        kind: "invoke",
                        selector: {
                            methodName: "onMessage",
                        },
                    },
                    slot: "callback_param",
                },
                dispatch: {
                    preset: "async_callback",
                },
            },
        ],
    };

    expectCompileError(invalidSpec, [
        "semantics[0].from.surface.kind must be one of: \"invoke\", \"method\", \"decorated_field\"",
        "semantics[0].from.slot must be one of: \"arg\", \"base\", \"result\", \"callback_param\", \"method_this\", \"method_param\", \"field_load\", \"decorated_field_value\"",
        "semantics[0].dispatch.preset must be one of: \"callback_sync\", \"callback_event\", \"promise_fulfilled\", \"promise_rejected\", \"promise_any\", \"declarative_field\"",
    ]);

    const scene = buildScene(repoRoot);

    const callbackBaseline = await runCase(scene, "callback_case.ets", "callback_case", {});
    const callbackWithFileSpec = await runCase(scene, "callback_case.ets", "callback_case", {
        moduleSpecFiles: [callbackSpecFile],
    });
    const carrierBaseline = await runCase(scene, "carrier_case.ets", "carrier_case", {});
    const carrierWithSpec = await runCase(scene, "carrier_case.ets", "carrier_case", { moduleSpecs: [carrierSpec] });
    const emitterScopeBaseline = await runCase(scene, "emitter_scope_case.ets", "emitter_scope_case", {});
    const emitterScopeWithSpec = await runCase(scene, "emitter_scope_case.ets", "emitter_scope_case", { moduleSpecs: [emitterSpec] });
    const keyedStateBaseline = await runCase(scene, "keyed_state_case.ets", "keyed_state_case", {});
    const keyedStateWithSpec = await runCase(scene, "keyed_state_case.ets", "keyed_state_case", { moduleSpecs: [keyedStateSpec] });
    const sameAddressBaseline = await runCase(scene, "same_address_case.ets", "same_address_case", {});
    const sameAddressWithSpec = await runCase(scene, "same_address_case.ets", "same_address_case", { moduleSpecs: [sameAddressSpec] });
    const methodFieldStateBaseline = await runCase(scene, "method_field_state_case.ets", "method_field_state_case", {});
    const methodFieldStateWithSpec = await runCase(scene, "method_field_state_case.ets", "method_field_state_case", { moduleSpecs: [methodFieldStateSpec] });
    const declarativeBaseline = await runCase(scene, "declarative_case.ets", "declarative_case", {});
    const declarativeWithSpec = await runCase(scene, "declarative_case.ets", "declarative_case", { moduleSpecs: [declarativeSpec] });
    const methodParamBaseline = await runCase(scene, "method_param_case.ets", "method_param_case", {});
    const methodParamWithSpec = await runCase(scene, "method_param_case.ets", "method_param_case", { moduleSpecs: [abilitySpec] });
    const emitterBaseline = await runCase(scene, "emitter_case.ets", "emitter_case", {});
    const emitterWithSpec = await runCase(scene, "emitter_case.ets", "emitter_case", { moduleSpecs: [emitterSpec] });
    const routerBaseline = await runCase(scene, "router_unwrap_case.ets", "router_unwrap_case", {});
    const routerWithSpec = await runCase(scene, "router_unwrap_case.ets", "router_unwrap_case", { moduleSpecs: [routerSpec] });
    const storagePropBaseline = await runCase(scene, "storage_prop_case.ets", "storage_prop_case", {});
    const storagePropWithSpec = await runCase(scene, "storage_prop_case.ets", "storage_prop_case", { moduleSpecs: [storagePropSpec] });
    const storagePropMismatchBaseline = await runCase(scene, "storage_prop_mismatch_case.ets", "storage_prop_mismatch_case", {});
    const storagePropMismatchWithSpec = await runCase(scene, "storage_prop_mismatch_case.ets", "storage_prop_mismatch_case", { moduleSpecs: [storagePropSpec] });
    const provideConsumeBaseline = await runCase(scene, "provide_consume_case.ets", "provide_consume_case", {});
    const provideConsumeWithSpec = await runCase(scene, "provide_consume_case.ets", "provide_consume_case", { moduleSpecs: [provideConsumeSpec] });
    const containerBaseline = await runCase(scene, "container_map_case.ets", "container_map_case", {});
    const containerWithSpec = await runCase(scene, "container_map_case.ets", "container_map_case", { moduleSpecs: [containerSpec] });
    const stringifyBaseline = await runCase(scene, "stringify_boundary_case.ets", "stringify_boundary_case", {});
    const stringifyWithSpec = await runCase(scene, "stringify_boundary_case.ets", "stringify_boundary_case", { moduleSpecs: [stringifyBoundarySpec] });
    const cloneCopyBaseline = await runCase(scene, "clone_copy_boundary_case.ets", "clone_copy_boundary_case", {});
    const cloneCopyWithSpec = await runCase(scene, "clone_copy_boundary_case.ets", "clone_copy_boundary_case", { moduleSpecs: [cloneCopyBoundarySpec] });

    assert(callbackBaseline.totalFlows === 0, `callback baseline should have zero flows, got ${callbackBaseline.totalFlows}`);
    assert(callbackWithFileSpec.totalFlows > 0, `callback file-based ModuleSpec should recover flows, got ${callbackWithFileSpec.totalFlows}`);
    assert(hasLoweredModule(callbackWithFileSpec.loadedModuleIds, callbackSpec.id), "callback file-based ModuleSpec should appear in loaded module audit ids");
    assert(callbackWithFileSpec.deferredContractCount > callbackBaseline.deferredContractCount, "callback file-based ModuleSpec should declare deferred contracts");

    assert(carrierBaseline.totalFlows === 0, `same-receiver baseline should have zero flows, got ${carrierBaseline.totalFlows}`);
    assert(carrierWithSpec.totalFlows > 0, `same-receiver ModuleSpec should recover flows, got ${carrierWithSpec.totalFlows}`);
    assert(hasLoweredModule(carrierWithSpec.loadedModuleIds, carrierSpec.id), "same-receiver ModuleSpec should appear in loaded module audit ids");
    assert(carrierWithSpec.deferredContractCount > carrierBaseline.deferredContractCount, "same-receiver ModuleSpec should declare deferred contracts");

    assert(emitterScopeBaseline.totalFlows === 0, `emitter scope baseline should have zero flows, got ${emitterScopeBaseline.totalFlows}`);
    assert(emitterScopeWithSpec.totalFlows === 0, `event emitter ModuleSpec should not bridge across different receiver classes, got ${emitterScopeWithSpec.totalFlows}`);

    assert(keyedStateBaseline.totalFlows === 0, `keyed state baseline should have zero flows, got ${keyedStateBaseline.totalFlows}`);
    assert(keyedStateWithSpec.totalFlows > 0, `keyed state ModuleSpec should recover flows, got ${keyedStateWithSpec.totalFlows}`);
    assert(hasLoweredModule(keyedStateWithSpec.loadedModuleIds, keyedStateSpec.id), "keyed state ModuleSpec should appear in loaded module audit ids");

    assert(sameAddressBaseline.totalFlows === 0, `same-address baseline should have zero flows, got ${sameAddressBaseline.totalFlows}`);
    assert(sameAddressWithSpec.totalFlows > 0, `same-address bridge ModuleSpec should recover flows, got ${sameAddressWithSpec.totalFlows}`);
    assert(hasLoweredModule(sameAddressWithSpec.loadedModuleIds, sameAddressSpec.id), "same-address bridge ModuleSpec should appear in loaded module audit ids");

    assert(methodFieldStateBaseline.totalFlows === 0, `method field state baseline should have zero flows, got ${methodFieldStateBaseline.totalFlows}`);
    assert(methodFieldStateWithSpec.totalFlows > 0, `method field state ModuleSpec should recover flows, got ${methodFieldStateWithSpec.totalFlows}`);
    assert(hasLoweredModule(methodFieldStateWithSpec.loadedModuleIds, methodFieldStateSpec.id), "method field state ModuleSpec should appear in loaded module audit ids");

    assert(declarativeBaseline.totalFlows === 0, `declarative baseline should have zero flows, got ${declarativeBaseline.totalFlows}`);
    assert(declarativeWithSpec.totalFlows > 0, `declarative ModuleSpec should recover flows, got ${declarativeWithSpec.totalFlows}`);
    assert(hasLoweredModule(declarativeWithSpec.loadedModuleIds, declarativeSpec.id), "declarative ModuleSpec should appear in loaded module audit ids");
    assert(declarativeWithSpec.deferredContractCount > declarativeBaseline.deferredContractCount, "declarative ModuleSpec should declare deferred contracts");

    assert(methodParamBaseline.totalFlows === 0, `ability handoff baseline should have zero flows, got ${methodParamBaseline.totalFlows}`);
    assert(methodParamWithSpec.totalFlows > 0, `ability handoff ModuleSpec should recover flows, got ${methodParamWithSpec.totalFlows}`);
    assert(hasLoweredModule(methodParamWithSpec.loadedModuleIds, abilitySpec.id), "ability handoff ModuleSpec should appear in loaded module audit ids");

    assert(emitterBaseline.totalFlows === 0, `event emitter baseline should have zero flows, got ${emitterBaseline.totalFlows}`);
    assert(emitterWithSpec.totalFlows > 0, `event emitter ModuleSpec should recover flows, got ${emitterWithSpec.totalFlows}`);
    assert(hasLoweredModule(emitterWithSpec.loadedModuleIds, emitterSpec.id), "event emitter ModuleSpec should appear in loaded module audit ids");
    assert(emitterWithSpec.deferredContractCount > emitterBaseline.deferredContractCount, "event emitter ModuleSpec should declare deferred contracts");

    assert(routerBaseline.totalFlows === 0, `route bridge baseline should have zero flows, got ${routerBaseline.totalFlows}`);
    assert(routerWithSpec.totalFlows > 0, `route bridge ModuleSpec should recover flows, got ${routerWithSpec.totalFlows}`);
    assert(hasLoweredModule(routerWithSpec.loadedModuleIds, routerSpec.id), "route bridge ModuleSpec should appear in loaded module audit ids");

    assert(storagePropBaseline.totalFlows === 0, `storage prop baseline should have zero flows, got ${storagePropBaseline.totalFlows}`);
    assert(storagePropWithSpec.totalFlows > 0, `keyed storage ModuleSpec should recover prop flows, got ${storagePropWithSpec.totalFlows}`);
    assert(hasLoweredModule(storagePropWithSpec.loadedModuleIds, storagePropSpec.id), "keyed storage ModuleSpec should appear in loaded module audit ids");
    assert(storagePropMismatchBaseline.totalFlows === 0, `storage prop mismatch baseline should have zero flows, got ${storagePropMismatchBaseline.totalFlows}`);
    assert(storagePropMismatchWithSpec.totalFlows === 0, `keyed storage ModuleSpec should respect mismatched decorator keys, got ${storagePropMismatchWithSpec.totalFlows}`);

    assert(provideConsumeBaseline.totalFlows === 0, `state binding baseline should have zero flows, got ${provideConsumeBaseline.totalFlows}`);
    assert(provideConsumeWithSpec.totalFlows > 0, `state binding ModuleSpec should recover provide/consume flows, got ${provideConsumeWithSpec.totalFlows}`);
    assert(hasLoweredModule(provideConsumeWithSpec.loadedModuleIds, provideConsumeSpec.id), "state binding ModuleSpec should appear in loaded module audit ids");

    assert(containerBaseline.totalFlows === 0, `container baseline should have zero flows, got ${containerBaseline.totalFlows}`);
    assert(containerWithSpec.totalFlows > 0, `container ModuleSpec should recover map flows, got ${containerWithSpec.totalFlows}`);
    assert(hasLoweredModule(containerWithSpec.loadedModuleIds, containerSpec.id), "container ModuleSpec should appear in loaded module audit ids");

    assert(stringifyBaseline.totalFlows === 0, `stringify boundary baseline should have zero flows, got ${stringifyBaseline.totalFlows}`);
    assert(stringifyWithSpec.totalFlows > 0, `stringify boundary ModuleSpec should recover flows, got ${stringifyWithSpec.totalFlows}`);
    assert(hasLoweredModule(stringifyWithSpec.loadedModuleIds, stringifyBoundarySpec.id), "stringify boundary ModuleSpec should appear in loaded module audit ids");

    assert(cloneCopyBaseline.totalFlows === 0, `clone-copy baseline should have zero flows, got ${cloneCopyBaseline.totalFlows}`);
    assert(cloneCopyWithSpec.totalFlows > 0, `clone-copy ModuleSpec should recover flows, got ${cloneCopyWithSpec.totalFlows}`);
    assert(hasLoweredModule(cloneCopyWithSpec.loadedModuleIds, cloneCopyBoundarySpec.id), "clone-copy ModuleSpec should appear in loaded module audit ids");

    console.log("PASS test_module_spec_engine");
    console.log(`callback_file_total_flows=${callbackWithFileSpec.totalFlows}`);
    console.log(`callback_deferred_contracts=${callbackWithFileSpec.deferredContractCount}`);
    console.log(`same_receiver_total_flows=${carrierWithSpec.totalFlows}`);
    console.log(`same_receiver_deferred_contracts=${carrierWithSpec.deferredContractCount}`);
    console.log(`emitter_scope_total_flows=${emitterScopeWithSpec.totalFlows}`);
    console.log(`keyed_state_total_flows=${keyedStateWithSpec.totalFlows}`);
    console.log(`same_address_total_flows=${sameAddressWithSpec.totalFlows}`);
    console.log(`method_field_state_total_flows=${methodFieldStateWithSpec.totalFlows}`);
    console.log(`declarative_total_flows=${declarativeWithSpec.totalFlows}`);
    console.log(`declarative_deferred_contracts=${declarativeWithSpec.deferredContractCount}`);
    console.log(`ability_handoff_total_flows=${methodParamWithSpec.totalFlows}`);
    console.log(`event_emitter_total_flows=${emitterWithSpec.totalFlows}`);
    console.log(`event_emitter_deferred_contracts=${emitterWithSpec.deferredContractCount}`);
    console.log(`route_bridge_total_flows=${routerWithSpec.totalFlows}`);
    console.log(`keyed_storage_total_flows=${storagePropWithSpec.totalFlows}`);
    console.log(`keyed_storage_mismatch_total_flows=${storagePropMismatchWithSpec.totalFlows}`);
    console.log(`state_binding_total_flows=${provideConsumeWithSpec.totalFlows}`);
    console.log(`container_total_flows=${containerWithSpec.totalFlows}`);
    console.log(`stringify_boundary_total_flows=${stringifyWithSpec.totalFlows}`);
    console.log(`clone_copy_total_flows=${cloneCopyWithSpec.totalFlows}`);
}

main().catch((error) => {
    console.error("FAIL test_module_spec_engine");
    console.error(error);
    process.exit(1);
});
