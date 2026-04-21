import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { ModuleSpec } from "../../core/kernel/contracts/ModuleSpec";
import { compileModuleSpec } from "../../core/orchestration/modules/ModuleSpecCompiler";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
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
    moduleSpecFile: string,
    projectRulePath: string,
): Promise<{
    totalFlows: number;
    loadedModuleIds: string[];
}> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath: path.resolve(projectRulePath),
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
        moduleSpecFiles: [moduleSpecFile],
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
    return {
        totalFlows: flows.length,
        loadedModuleIds: engine.getModuleAuditSnapshot().loadedModuleIds,
    };
}

type RuntimeCase = {
    id: string;
    file: string;
    entry: string;
    expectedFlows: number;
    note: string;
};

type RuntimeFamily = {
    id: string;
    title: string;
    semantic: string;
    why: string;
    spec: ModuleSpec;
    files: Record<string, string>;
    projectRules?: Record<string, unknown>;
    cases: RuntimeCase[];
};

type CompileCase = {
    id: string;
    spec: unknown;
    expectedSubstrings: string[];
    note: string;
};

type CompileFamily = {
    id: string;
    title: string;
    semantic: string;
    why: string;
    cases: CompileCase[];
};

type RuntimeResult = {
    kind: "runtime";
    id: string;
    title: string;
    semantic: string;
    why: string;
    compiledModuleIds: string[];
    cases: Array<RuntimeCase & { actualFlows: number; passed: boolean }>;
};

type CompileResult = {
    kind: "compile";
    id: string;
    title: string;
    semantic: string;
    why: string;
    cases: Array<CompileCase & { passed: boolean; message: string }>;
};

function writeProjectRules(projectRulePath: string, rules?: Record<string, unknown>): void {
    writeText(
        projectRulePath,
        JSON.stringify(rules || {
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.semantic_edge_suite",
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
                    id: "sink.fixture.semantic_edge_suite",
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
}

function buildRuntimeFamilies(): RuntimeFamily[] {
    return [
        {
            id: "event_receiver_scope",
            title: "EventEmitter receiver/class isolation",
            semantic: "event_emitter",
            why: "Ensure identical on/emit names do not cross-connect across instances or classes.",
            spec: {
                id: "edge.event_receiver_scope",
                semantics: [
                    {
                        kind: "event_emitter",
                        onMethods: ["on"],
                        emitMethods: ["emit"],
                    },
                ],
            },
            files: {
                "event_same_receiver_same_topic_T.ets": [
                    "class SignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "class OtherSignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function event_same_receiver_same_topic_T(): void {",
                    "  const bus = new SignalBus();",
                    "  bus.on(\"ready\", (payload: string) => { Sink(payload); });",
                    "  bus.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "event_other_receiver_same_topic_F.ets": [
                    "class SignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function event_other_receiver_same_topic_F(): void {",
                    "  const left = new SignalBus();",
                    "  const right = new SignalBus();",
                    "  left.on(\"ready\", (payload: string) => { Sink(payload); });",
                    "  right.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "event_other_class_same_topic_F.ets": [
                    "class SignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "class OtherSignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function event_other_class_same_topic_F(): void {",
                    "  const left = new SignalBus();",
                    "  const right = new OtherSignalBus();",
                    "  left.on(\"ready\", (payload: string) => { Sink(payload); });",
                    "  right.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "event_same_receiver_same_topic_T",
                    file: "event_same_receiver_same_topic_T.ets",
                    entry: "event_same_receiver_same_topic_T",
                    expectedFlows: 1,
                    note: "same receiver, same topic should connect",
                },
                {
                    id: "event_other_receiver_same_topic_F",
                    file: "event_other_receiver_same_topic_F.ets",
                    entry: "event_other_receiver_same_topic_F",
                    expectedFlows: 0,
                    note: "same class, different receiver should stay isolated",
                },
                {
                    id: "event_other_class_same_topic_F",
                    file: "event_other_class_same_topic_F.ets",
                    entry: "event_other_class_same_topic_F",
                    expectedFlows: 0,
                    note: "different class, same method names should stay isolated",
                },
            ],
        },
        {
            id: "event_composite_channel",
            title: "EventEmitter composite channel isolation",
            semantic: "event_emitter",
            why: "Ensure topic + lane is treated as a composite channel rather than one flat key.",
            spec: {
                id: "edge.event_composite_channel",
                semantics: [
                    {
                        kind: "event_emitter",
                        onMethods: ["on"],
                        emitMethods: ["publish"],
                        channelArgIndexes: [0, 1],
                        payloadArgIndex: 2,
                        callbackArgIndex: 2,
                        callbackParamIndex: 0,
                    },
                ],
            },
            files: {
                "lane_same_topic_same_lane_T.ets": [
                    "class LaneBus {",
                    "  on(topic: string, lane: string, callback: (payload: string) => void): void {}",
                    "  publish(topic: string, lane: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function lane_same_topic_same_lane_T(): void {",
                    "  const bus = new LaneBus();",
                    "  bus.on(\"ready\", \"left\", (payload: string) => { Sink(payload); });",
                    "  bus.publish(\"ready\", \"left\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "lane_same_topic_other_lane_F.ets": [
                    "class LaneBus {",
                    "  on(topic: string, lane: string, callback: (payload: string) => void): void {}",
                    "  publish(topic: string, lane: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function lane_same_topic_other_lane_F(): void {",
                    "  const bus = new LaneBus();",
                    "  bus.on(\"ready\", \"left\", (payload: string) => { Sink(payload); });",
                    "  bus.publish(\"ready\", \"right\", Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "lane_same_topic_same_lane_T",
                    file: "lane_same_topic_same_lane_T.ets",
                    entry: "lane_same_topic_same_lane_T",
                    expectedFlows: 1,
                    note: "same topic and same lane should connect",
                },
                {
                    id: "lane_same_topic_other_lane_F",
                    file: "lane_same_topic_other_lane_F.ets",
                    entry: "lane_same_topic_other_lane_F",
                    expectedFlows: 0,
                    note: "same topic but different lane should stay isolated",
                },
            ],
        },
        {
            id: "event_cross_file_receiver",
            title: "EventEmitter cross-file receiver isolation",
            semantic: "event_emitter",
            why: "Ensure same-receiver matching holds across files, and different instances stay isolated.",
            spec: {
                id: "edge.event_cross_file_receiver",
                semantics: [
                    {
                        kind: "event_emitter",
                        onMethods: ["on"],
                        emitMethods: ["emit"],
                    },
                ],
            },
            files: {
                "bus.ts": [
                    "export class CrossBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                ].join("\n"),
                "helpers.ts": [
                    "export function Source(): string { return \"taint\"; }",
                    "export function Sink(v: string): void {}",
                    "",
                ].join("\n"),
                "register.ts": [
                    "import { CrossBus } from \"./bus\";",
                    "import { Sink } from \"./helpers\";",
                    "",
                    "export function register(bus: CrossBus): void {",
                    "  bus.on(\"ready\", (payload: string) => Sink(payload));",
                    "}",
                    "",
                ].join("\n"),
                "fire.ts": [
                    "import { CrossBus } from \"./bus\";",
                    "import { Source } from \"./helpers\";",
                    "",
                    "export function fire(bus: CrossBus): void {",
                    "  bus.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "cross_file_same_receiver_T.ets": [
                    "import { CrossBus } from \"./bus\";",
                    "import { register } from \"./register\";",
                    "import { fire } from \"./fire\";",
                    "",
                    "export function cross_file_same_receiver_T(): void {",
                    "  const bus = new CrossBus();",
                    "  register(bus);",
                    "  fire(bus);",
                    "}",
                    "",
                ].join("\n"),
                "cross_file_other_receiver_F.ets": [
                    "import { CrossBus } from \"./bus\";",
                    "import { register } from \"./register\";",
                    "import { fire } from \"./fire\";",
                    "",
                    "export function cross_file_other_receiver_F(): void {",
                    "  const left = new CrossBus();",
                    "  const right = new CrossBus();",
                    "  register(left);",
                    "  fire(right);",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "cross_file_same_receiver_T",
                    file: "cross_file_same_receiver_T.ets",
                    entry: "cross_file_same_receiver_T",
                    expectedFlows: 1,
                    note: "same receiver across files should connect",
                },
                {
                    id: "cross_file_other_receiver_F",
                    file: "cross_file_other_receiver_F.ets",
                    entry: "cross_file_other_receiver_F",
                    expectedFlows: 0,
                    note: "different instances across files should stay isolated",
                },
            ],
        },
        {
            id: "keyed_storage_instance_scope",
            title: "KeyedStorage instance isolation",
            semantic: "keyed_storage",
            why: "Ensure the semantic does not collapse different instances onto one global key domain.",
            spec: {
                id: "edge.keyed_storage_instance_scope",
                semantics: [
                    {
                        kind: "keyed_storage",
                        storageClasses: ["PocketStore"],
                        writeMethods: [{ methodName: "put", valueIndex: 1 }],
                        readMethods: ["take"],
                        propDecorators: [],
                        linkDecorators: [],
                    },
                ],
            },
            files: {
                "store_same_instance_same_key_T.ets": [
                    "class PocketStore {",
                    "  put(key: string, value: string): void {}",
                    "  take(key: string): string { return \"safe\"; }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function store_same_instance_same_key_T(): void {",
                    "  const store = new PocketStore();",
                    "  store.put(\"token\", Source());",
                    "  Sink(store.take(\"token\"));",
                    "}",
                    "",
                ].join("\n"),
                "store_same_instance_other_key_F.ets": [
                    "class PocketStore {",
                    "  put(key: string, value: string): void {}",
                    "  take(key: string): string { return \"safe\"; }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function store_same_instance_other_key_F(): void {",
                    "  const store = new PocketStore();",
                    "  store.put(\"token\", Source());",
                    "  Sink(store.take(\"other\"));",
                    "}",
                    "",
                ].join("\n"),
                "store_other_instance_same_key_F.ets": [
                    "class PocketStore {",
                    "  put(key: string, value: string): void {}",
                    "  take(key: string): string { return \"safe\"; }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function store_other_instance_same_key_F(): void {",
                    "  const left = new PocketStore();",
                    "  const right = new PocketStore();",
                    "  left.put(\"token\", Source());",
                    "  Sink(right.take(\"token\"));",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "store_same_instance_same_key_T",
                    file: "store_same_instance_same_key_T.ets",
                    entry: "store_same_instance_same_key_T",
                    expectedFlows: 1,
                    note: "same instance, same key should connect",
                },
                {
                    id: "store_same_instance_other_key_F",
                    file: "store_same_instance_other_key_F.ets",
                    entry: "store_same_instance_other_key_F",
                    expectedFlows: 0,
                    note: "same instance, different key should stay isolated",
                },
                {
                    id: "store_other_instance_same_key_F",
                    file: "store_other_instance_same_key_F.ets",
                    entry: "store_other_instance_same_key_F",
                    expectedFlows: 0,
                    note: "different instance, same key should stay isolated",
                },
            ],
        },
        {
            id: "route_bridge_route_scope",
            title: "RouteBridge route-key isolation",
            semantic: "route_bridge",
            why: "Ensure navigation callbacks only receive params for the matched route key.",
            spec: {
                id: "edge.route_bridge_route_scope",
                semantics: [
                    {
                        kind: "route_bridge",
                        pushMethods: [{ methodName: "pushPath", routeField: "name" }],
                        getMethods: ["getParams"],
                        navDestinationClassNames: ["NavDestination"],
                        navDestinationRegisterMethods: ["register"],
                        payloadUnwrapPrefixes: ["param"],
                    },
                ],
            },
            files: {
                "nav_same_route_T.ets": [
                    "class Payload020 {",
                    "  secret: string = \"safe\";",
                    "}",
                    "",
                    "class NavPathStack {",
                    "  private static store: Map<string, Payload020> = new Map<string, Payload020>();",
                    "  static pushPath(options: { name: string; param: Payload020 }): void {",
                    "    NavPathStack.store.set(options.name, options.param);",
                    "  }",
                    "  static getParams(name?: string): Payload020 {",
                    "    return name && NavPathStack.store.has(name) ? NavPathStack.store.get(name)! : new Payload020();",
                    "  }",
                    "}",
                    "",
                    "class NavDestination {",
                    "  private static builders: Map<string, (param: Payload020) => void> = new Map<string, (param: Payload020) => void>();",
                    "  static register(name: string, builder: (param: Payload020) => void): void {",
                    "    NavDestination.builders.set(name, builder);",
                    "  }",
                    "  static trigger(name: string): void {",
                    "    const builder = NavDestination.builders.get(name);",
                    "    if (builder) builder(NavPathStack.getParams(name));",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function nav_same_route_T(): void {",
                    "  NavDestination.register(\"Detail\", (param: Payload020) => { Sink(param.secret); });",
                    "  const payload = new Payload020();",
                    "  payload.secret = Source();",
                    "  NavPathStack.pushPath({ name: \"Detail\", param: payload });",
                    "  NavDestination.trigger(\"Detail\");",
                    "}",
                    "",
                ].join("\n"),
                "nav_other_route_F.ets": [
                    "class Payload020 {",
                    "  secret: string = \"safe\";",
                    "}",
                    "",
                    "class NavPathStack {",
                    "  private static store: Map<string, Payload020> = new Map<string, Payload020>();",
                    "  static pushPath(options: { name: string; param: Payload020 }): void {",
                    "    NavPathStack.store.set(options.name, options.param);",
                    "  }",
                    "  static getParams(name?: string): Payload020 {",
                    "    return name && NavPathStack.store.has(name) ? NavPathStack.store.get(name)! : new Payload020();",
                    "  }",
                    "}",
                    "",
                    "class NavDestination {",
                    "  private static builders: Map<string, (param: Payload020) => void> = new Map<string, (param: Payload020) => void>();",
                    "  static register(name: string, builder: (param: Payload020) => void): void {",
                    "    NavDestination.builders.set(name, builder);",
                    "  }",
                    "  static trigger(name: string): void {",
                    "    const builder = NavDestination.builders.get(name);",
                    "    if (builder) builder(NavPathStack.getParams(name));",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function nav_other_route_F(): void {",
                    "  NavDestination.register(\"Detail\", (param: Payload020) => { Sink(param.secret); });",
                    "  const payload = new Payload020();",
                    "  payload.secret = Source();",
                    "  NavPathStack.pushPath({ name: \"SafeDetail\", param: payload });",
                    "  NavDestination.trigger(\"Detail\");",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "nav_same_route_T",
                    file: "nav_same_route_T.ets",
                    entry: "nav_same_route_T",
                    expectedFlows: 1,
                    note: "register/trigger with the same route should connect",
                },
                {
                    id: "nav_other_route_F",
                    file: "nav_other_route_F.ets",
                    entry: "nav_other_route_F",
                    expectedFlows: 0,
                    note: "different route key should stay isolated",
                },
            ],
        },
        {
            id: "state_binding_key_scope",
            title: "StateBinding key and field-name isolation",
            semantic: "state_binding",
            why: "Ensure provide/consume pairs match by explicit key or by implicit field name only.",
            spec: {
                id: "edge.state_binding_key_scope",
                semantics: [
                    {
                        kind: "state_binding",
                        stateDecorators: ["State"],
                        propDecorators: ["Prop", "Link", "ObjectLink", "Local", "Param", "Once", "Event", "Trace"],
                        linkDecorators: ["Link", "ObjectLink", "Local", "Trace"],
                        provideDecorators: ["Provide"],
                        consumeDecorators: ["Consume"],
                        eventDecorators: ["Event"],
                    },
                ],
            },
            files: {
                "provide_consume_same_key_T.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer031 {",
                    "  @Consume(\"token\")",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider031 {",
                    "  @Provide(\"token\")",
                    "  token: string = \"\";",
                    "  build(v: string): void {",
                    "    this.token = v;",
                    "    new Consumer031().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_same_key_T(): void {",
                    "  new Provider031().build(Source());",
                    "}",
                    "",
                ].join("\n"),
                "provide_consume_other_key_F.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer032 {",
                    "  @Consume(\"token\")",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider032 {",
                    "  @Provide(\"other\")",
                    "  token: string = \"\";",
                    "  build(v: string): void {",
                    "    this.token = v;",
                    "    new Consumer032().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_other_key_F(): void {",
                    "  new Provider032().build(Source());",
                    "}",
                    "",
                ].join("\n"),
                "provide_consume_noarg_same_field_T.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer033 {",
                    "  @Consume()",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider033 {",
                    "  @Provide()",
                    "  token: string = \"\";",
                    "  build(v: string): void {",
                    "    this.token = v;",
                    "    new Consumer033().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_noarg_same_field_T(): void {",
                    "  new Provider033().build(Source());",
                    "}",
                    "",
                ].join("\n"),
                "provide_consume_noarg_other_field_F.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer034 {",
                    "  @Consume()",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider034 {",
                    "  @Provide()",
                    "  other: string = \"\";",
                    "  build(v: string): void {",
                    "    this.other = v;",
                    "    new Consumer034().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_noarg_other_field_F(): void {",
                    "  new Provider034().build(Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "provide_consume_same_key_T",
                    file: "provide_consume_same_key_T.ets",
                    entry: "provide_consume_same_key_T",
                    expectedFlows: 1,
                    note: "explicit same key should connect",
                },
                {
                    id: "provide_consume_other_key_F",
                    file: "provide_consume_other_key_F.ets",
                    entry: "provide_consume_other_key_F",
                    expectedFlows: 0,
                    note: "explicit different key should stay isolated",
                },
                {
                    id: "provide_consume_noarg_same_field_T",
                    file: "provide_consume_noarg_same_field_T.ets",
                    entry: "provide_consume_noarg_same_field_T",
                    expectedFlows: 1,
                    note: "implicit same field name should connect",
                },
                {
                    id: "provide_consume_noarg_other_field_F",
                    file: "provide_consume_noarg_other_field_F.ets",
                    entry: "provide_consume_noarg_other_field_F",
                    expectedFlows: 0,
                    note: "implicit different field name should stay isolated",
                },
            ],
        },
        {
            id: "ability_handoff_guards",
            title: "AbilityHandoff target guards",
            semantic: "ability_handoff",
            why: "Ensure only ability-like lifecycle methods participate and self-targeting is excluded.",
            spec: {
                id: "edge.ability_handoff_guards",
                semantics: [
                    {
                        kind: "ability_handoff",
                        startMethods: ["startAbility"],
                        targetMethods: ["onCreate"],
                    },
                ],
            },
            projectRules: {
                schemaVersion: "2.0",
                sources: [
                    {
                        id: "source.fixture.ability_handoff.entry_param",
                        match: {
                            kind: "local_name_regex",
                            value: "^taint_src$",
                        },
                        sourceKind: "entry_param",
                        target: "arg0",
                    },
                ],
                sinks: [
                    {
                        id: "sink.fixture.ability_handoff",
                        match: {
                            kind: "method_name_equals",
                            value: "Sink",
                        },
                        target: "arg0",
                    },
                ],
                sanitizers: [],
                transfers: [],
            },
            files: {
                "taint_mock.ts": [
                    "export class Want {",
                    "  token: any;",
                    "  constructor(token: any) {",
                    "    this.token = token;",
                    "  }",
                    "}",
                    "",
                    "export class AbilityContext {",
                    "  startAbility(want: any): void {",
                    "    void want;",
                    "  }",
                    "}",
                    "",
                    "export class UIAbility {",
                    "  context: AbilityContext = new AbilityContext();",
                    "}",
                    "",
                    "export namespace taint {",
                    "  export function Sink(v: string): void {",
                    "    void v;",
                    "  }",
                    "}",
                    "",
                ].join("\n"),
                "ability_target_T.ets": [
                    "import { UIAbility, Want, taint } from \"./taint_mock\";",
                    "",
                    "class TargetAbility extends UIAbility {",
                    "  onCreate(want: Want): void { taint.Sink(want.token); }",
                    "}",
                    "",
                    "class EntryPage {",
                    "  context: any;",
                    "  constructor(context: any) {",
                    "    this.context = context;",
                    "  }",
                    "  build(taint_src: string): void {",
                    "    const want = new Want(taint_src);",
                    "    this.context.startAbility(want);",
                    "  }",
                    "}",
                    "",
                    "export function ability_target_T(taint_src: string): void {",
                    "  const entryTarget = new TargetAbility();",
                    "  new EntryPage(entryTarget.context).build(taint_src);",
                    "  const renderTarget = new TargetAbility();",
                    "  renderTarget.onCreate(new Want(\"clean\"));",
                    "}",
                    "",
                ].join("\n"),
                "ability_plain_class_F.ets": [
                    "import { UIAbility, Want, taint } from \"./taint_mock\";",
                    "",
                    "class PlainController {",
                    "  onCreate(want: Want): void { taint.Sink(want.token); }",
                    "}",
                    "",
                    "class EntryPage {",
                    "  context: any;",
                    "  constructor(context: any) {",
                    "    this.context = context;",
                    "  }",
                    "  build(taint_src: string): void {",
                    "    const want = new Want(taint_src);",
                    "    this.context.startAbility(want);",
                    "  }",
                    "}",
                    "",
                    "export function ability_plain_class_F(taint_src: string): void {",
                    "  const ability = new UIAbility();",
                    "  new EntryPage(ability.context).build(taint_src);",
                    "  new PlainController().onCreate(new Want(\"clean\"));",
                    "}",
                    "",
                ].join("\n"),
                "ability_same_class_self_F.ets": [
                    "import { UIAbility, Want, taint } from \"./taint_mock\";",
                    "",
                    "class SelfAbility extends UIAbility {",
                    "  build(taint_src: string): void { this.context.startAbility(new Want(taint_src)); }",
                    "  onCreate(want: Want): void {",
                    "    taint.Sink(want.token);",
                    "  }",
                    "}",
                    "",
                    "export function ability_same_class_self_F(taint_src: string): void {",
                    "  const ability = new SelfAbility();",
                    "  ability.build(taint_src);",
                    "  ability.onCreate(new Want(\"clean\"));",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "ability_target_T",
                    file: "ability_target_T.ets",
                    entry: "ability_target_T",
                    expectedFlows: 1,
                    note: "ability-like onCreate should receive Want payloads",
                },
                {
                    id: "ability_plain_class_F",
                    file: "ability_plain_class_F.ets",
                    entry: "ability_plain_class_F",
                    expectedFlows: 0,
                    note: "plain classes named onCreate should be ignored",
                },
                {
                    id: "ability_same_class_self_F",
                    file: "ability_same_class_self_F.ets",
                    entry: "ability_same_class_self_F",
                    expectedFlows: 0,
                    note: "source class should not target its own lifecycle method",
                },
            ],
        },
        {
            id: "generic_same_address_bridge",
            title: "Generic bridge same_address guard",
            semantic: "bridge",
            why: "Ensure generic same_address matching still behaves precisely for keyed bridge semantics.",
            spec: {
                id: "edge.generic_same_address_bridge",
                semantics: [
                    {
                        kind: "bridge",
                        from: {
                            surface: "PutAddress",
                            slot: "arg",
                            index: 1,
                        },
                        to: {
                            surface: "GetAddress",
                            slot: "result",
                        },
                        constraints: [
                            {
                                kind: "same_address",
                                left: {
                                    kind: "endpoint",
                                    endpoint: {
                                        surface: "PutAddress",
                                        slot: "arg",
                                        index: 0,
                                    },
                                },
                                right: {
                                    kind: "endpoint",
                                    endpoint: {
                                        surface: "GetAddress",
                                        slot: "arg",
                                        index: 0,
                                    },
                                },
                            },
                        ],
                        emit: {
                            allowUnreachableTarget: true,
                        },
                    },
                ],
            },
            files: {
                "same_address_same_key_T.ets": [
                    "function PutAddress(key: string, value: string): void {}",
                    "function GetAddress(key: string): string { return \"safe\"; }",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function same_address_same_key_T(): void {",
                    "  PutAddress(\"token\", Source());",
                    "  Sink(GetAddress(\"token\"));",
                    "}",
                    "",
                ].join("\n"),
                "same_address_other_key_F.ets": [
                    "function PutAddress(key: string, value: string): void {}",
                    "function GetAddress(key: string): string { return \"safe\"; }",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function same_address_other_key_F(): void {",
                    "  PutAddress(\"token\", Source());",
                    "  Sink(GetAddress(\"other\"));",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "same_address_same_key_T",
                    file: "same_address_same_key_T.ets",
                    entry: "same_address_same_key_T",
                    expectedFlows: 1,
                    note: "same address should connect",
                },
                {
                    id: "same_address_other_key_F",
                    file: "same_address_other_key_F.ets",
                    entry: "same_address_other_key_F",
                    expectedFlows: 0,
                    note: "different address should stay isolated",
                },
            ],
        },
    ];
}

function buildCompileFamilies(): CompileFamily[] {
    return [
        {
            id: "generic_constraint_guard",
            title: "Generic bridge constraint guard",
            semantic: "bridge",
            why: "Keep the canonical guard that forbids mixing same_receiver and same_address in one bridge.",
            cases: [
                {
                    id: "bridge_same_receiver_and_same_address_rejected",
                    spec: {
                        id: "edge.invalid.receiver_and_address",
                        semantics: [
                            {
                                kind: "bridge",
                                from: {
                                    surface: "PutScoped",
                                    slot: "arg",
                                    index: 1,
                                },
                                to: {
                                    surface: "GetScoped",
                                    slot: "result",
                                },
                                constraints: [
                                    { kind: "same_receiver" },
                                    {
                                        kind: "same_address",
                                        left: {
                                            kind: "endpoint",
                                            endpoint: {
                                                surface: "PutScoped",
                                                slot: "arg",
                                                index: 0,
                                            },
                                        },
                                        right: {
                                            kind: "endpoint",
                                            endpoint: {
                                                surface: "GetScoped",
                                                slot: "arg",
                                                index: 0,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    expectedSubstrings: [
                        "cannot combine same_receiver and same_address in one bridge",
                    ],
                    note: "mixed receiver/address bridge should be rejected explicitly",
                },
            ],
        },
    ];
}

async function runRuntimeFamily(root: string, family: RuntimeFamily): Promise<RuntimeResult> {
    const familyDir = path.join(root, family.id);
    const inputsDir = path.join(familyDir, "inputs");
    const projectRulePath = path.join(familyDir, "project.rules.json");
    const moduleSpecPath = path.join(familyDir, "module_spec.json");
    for (const [name, content] of Object.entries(family.files)) {
        writeText(path.join(inputsDir, name), content);
    }
    writeProjectRules(projectRulePath, family.projectRules);
    writeText(moduleSpecPath, JSON.stringify(family.spec, null, 2));

    const compiled = compileModuleSpec(family.spec);
    const scene = buildScene(inputsDir);
    const cases: Array<RuntimeCase & { actualFlows: number; passed: boolean }> = [];
    for (const item of family.cases) {
        const actual = await runCase(scene, item.file, item.entry, moduleSpecPath, projectRulePath);
        const passed = item.expectedFlows === 0
            ? actual.totalFlows === 0
            : actual.totalFlows >= item.expectedFlows;
        cases.push({
            ...item,
            actualFlows: actual.totalFlows,
            passed,
        });
    }
    return {
        kind: "runtime",
        id: family.id,
        title: family.title,
        semantic: family.semantic,
        why: family.why,
        compiledModuleIds: compiled.map(module => module.id),
        cases,
    };
}

function runCompileFamily(family: CompileFamily): CompileResult {
    const cases: Array<CompileCase & { passed: boolean; message: string }> = [];
    for (const item of family.cases) {
        let passed = true;
        let message = "";
        try {
            compileModuleSpec(item.spec as ModuleSpec);
            passed = false;
            message = "expected compileModuleSpec to fail";
        } catch (error) {
            message = String((error as any)?.message || error);
            for (const expected of item.expectedSubstrings) {
                if (!message.includes(expected)) {
                    passed = false;
                    break;
                }
            }
        }
        cases.push({
            ...item,
            passed,
            message,
        });
    }
    return {
        kind: "compile",
        id: family.id,
        title: family.title,
        semantic: family.semantic,
        why: family.why,
        cases,
    };
}

function renderReport(results: Array<RuntimeResult | CompileResult>): string {
    const lines: string[] = [];
    lines.push("# Module Semantic Edge Suite");
    lines.push("");
    lines.push("Goal: catch structural precision leaks instead of only re-running ordinary happy-path cases.");
    lines.push("");
    lines.push("Excluded: ability_handoff_guards (OOM in standalone run; keep as dedicated heavy fixture).");
    lines.push("");
    for (const family of results) {
        lines.push(`## ${family.title}`);
        lines.push("");
        lines.push(`- family id: \`${family.id}\``);
        lines.push(`- semantic: \`${family.semantic}\``);
        lines.push(`- why: ${family.why}`);
        if (family.kind === "runtime") {
            lines.push(`- compiled modules: \`${family.compiledModuleIds.join(", ")}\``);
            lines.push("");
            lines.push("| case | expected | actual | result | note |");
            lines.push("| --- | --- | --- | --- | --- |");
            for (const item of family.cases) {
                lines.push(`| \`${item.id}\` | \`${item.expectedFlows}\` | \`${item.actualFlows}\` | \`${item.passed ? "PASS" : "FAIL"}\` | ${item.note} |`);
            }
        } else {
            lines.push("");
            lines.push("| case | result | note |");
            lines.push("| --- | --- | --- |");
            for (const item of family.cases) {
                lines.push(`| \`${item.id}\` | \`${item.passed ? "PASS" : "FAIL"}\` | ${item.note} |`);
            }
        }
        lines.push("");
    }
    return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_semantic_edge_suite");
    const runtimeFamilies = buildRuntimeFamilies();
    const compileFamilies = buildCompileFamilies();
    const requestedFamilyId = process.argv[2];
    if (requestedFamilyId) {
        const runtimeFamily = runtimeFamilies.find(family => family.id === requestedFamilyId);
        if (runtimeFamily) {
            const result = await runRuntimeFamily(root, runtimeFamily);
            process.stdout.write(JSON.stringify(result));
            return;
        }
        const compileFamily = compileFamilies.find(family => family.id === requestedFamilyId);
        if (compileFamily) {
            const result = runCompileFamily(compileFamily);
            process.stdout.write(JSON.stringify(result));
            return;
        }
        throw new Error(`unknown module semantic edge family: ${requestedFamilyId}`);
    }

    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const results: Array<RuntimeResult | CompileResult> = [];
    const stableRuntimeFamilies = runtimeFamilies.filter(family => family.id !== "ability_handoff_guards");
    const familyIds = [
        ...stableRuntimeFamilies.map(family => family.id),
        ...compileFamilies.map(family => family.id),
    ];
    for (const familyId of familyIds) {
        const stdout = execFileSync(process.execPath, [__filename, familyId], {
            cwd: process.cwd(),
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
        });
        results.push(JSON.parse(stdout) as RuntimeResult | CompileResult);
    }

    writeText(path.join(root, "results.json"), JSON.stringify(results, null, 2));
    writeText(path.join(root, "REPORT.md"), renderReport(results));

    const failed = results.some(family => family.cases.some(item => !item.passed));
    if (failed) {
        throw new Error("module semantic edge suite has failing cases");
    }

    console.log("PASS test_module_semantic_edge_suite");
    for (const family of results) {
        const passCount = family.cases.filter(item => item.passed).length;
        console.log(`${family.id}_pass=${passCount}/${family.cases.length}`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
