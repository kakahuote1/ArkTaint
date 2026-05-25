import * as fs from "fs";
import * as path from "path";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildSemanticFlowArtifact } from "../../core/semanticflow/SemanticFlowArtifacts";
import { SemanticFlowAnchor, SemanticFlowSummary } from "../../core/semanticflow/SemanticFlowTypes";
import { SinkRule, SourceRule, TaintRuleSet } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { buildTestScene } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFile(filePath: string, lines: string[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

function findMethod(scene: ReturnType<typeof buildTestScene>, name: string): any {
    return scene.getMethods().find(method => method.getName?.() === name);
}

async function detectFlow(entryName: string, sourceRules: SourceRule[]): Promise<boolean> {
    const root = path.resolve("tmp/test_runs/runtime/callback_field_name_source_rule/latest");
    const projectDir = path.join(root, "project");
    const scene = buildTestScene(projectDir);
    const entryMethod = findMethod(scene, entryName);
    assert(entryMethod, `missing entry method ${entryName}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(SINK_RULES);
    return flows.length > 0;
}

const FIELD_SCOPED_SOURCE_RULE: SourceRule = {
    id: "source.project.multiinput.onTextChange",
    sourceKind: "callback_param",
    match: {
        kind: "method_name_equals",
        value: "MultiInput",
        argCount: 1,
    },
    target: { endpoint: "arg0" },
    callbackArgIndexes: [0],
    callbackFieldNames: ["onTextChange"],
};

const BROAD_SOURCE_RULE: SourceRule = {
    ...FIELD_SCOPED_SOURCE_RULE,
    id: "source.project.multiinput.broad",
    callbackFieldNames: undefined,
};

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.test.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    },
];

const RESPONSE_INTERCEPTOR_SOURCE_RULE: SourceRule = {
    id: "source.project.interceptor.response",
    sourceKind: "callback_param",
    match: {
        kind: "method_name_equals",
        value: "use",
        invokeKind: "instance",
        argCount: 1,
        typeHint: "interceptors.response",
    },
    scope: {
        file: {
            mode: "contains",
            value: "Case.ets",
        },
    },
    target: { endpoint: "arg0" },
    callbackArgIndexes: [0],
};

function prepareProject(): void {
    const root = path.resolve("tmp/test_runs/runtime/callback_field_name_source_rule/latest/project");
    fs.rmSync(root, { recursive: true, force: true });
    writeFile(path.join(root, "entry/src/main/ets/Case.ets"), [
        "function Sink(value: string): void {",
        "}",
        "",
        "function MultiInput(options: {",
        "  onTextChange: (value: string) => void,",
        "  onTap: (value: string) => void",
        "}): void {",
        "}",
        "",
        "export function positive(): void {",
        "  MultiInput({",
        "    onTextChange: (value: string): void => { Sink(value); },",
        "    onTap: (value: string): void => { }",
        "  });",
        "}",
        "",
        "export function negative(): void {",
        "  MultiInput({",
        "    onTextChange: (value: string): void => { },",
        "    onTap: (value: string): void => { Sink(value); }",
        "  });",
        "}",
        "",
        "export function responseInterceptor(): void {",
        "  const api: any = {};",
        "  api.interceptors.response.use((response: string): void => { Sink(response); });",
        "}",
        "",
        "export function requestInterceptor(): void {",
        "  const api: any = {};",
        "  api.interceptors.request.use((config: string): void => { Sink(config); });",
        "}",
        "",
        "export function responseInterceptorWithCapture(): void {",
        "  const api: any = {};",
        "  const prefix = 'captured';",
        "  api.interceptors.response.use((response: string): void => {",
        "    const label = prefix;",
        "    Sink(response);",
        "  });",
        "}",
    ]);
}

function assertArtifactCallbackFieldNames(): void {
    const anchor: SemanticFlowAnchor = {
        id: "rule.project.MultiInput",
        surface: "MultiInput",
        methodSignature: "@unk/%unk: .MultiInput()",
        callbackProperties: ["onTextChange"],
        metaTags: ["rule", "candidate", "static"],
    };
    const summary: SemanticFlowSummary = {
        inputs: [],
        outputs: [{ slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 }],
        transfers: [],
        confidence: "high",
        ruleKind: "source",
        sourceKind: "callback_param",
    };
    const artifact = buildSemanticFlowArtifact(anchor, summary, "rule");
    assert(artifact.kind === "rule", "expected rule artifact");
    const generated = artifact.ruleSet.sources[0];
    assert(generated.match.kind === "method_name_equals" && generated.match.value === "MultiInput", "unknown proactive signatures should fall back to method_name_equals");
    assert(generated.match.invokeKind === undefined, "option-object callback source rules must not assume static lowering");
    assert(JSON.stringify(generated.callbackFieldNames) === JSON.stringify(["onTextChange"]), "single callbackProperties should be preserved as callbackFieldNames");

    const explicitSummary: SemanticFlowSummary = {
        ...summary,
        outputs: [{ slot: "callback_param", callbackArgIndex: 0, paramIndex: 0, fieldName: "onPasswordChange" }],
    };
    const explicitArtifact = buildSemanticFlowArtifact({
        ...anchor,
        callbackProperties: ["onPhoneChange", "onPasswordChange"],
    }, explicitSummary, "rule");
    assert(explicitArtifact.kind === "rule", "expected explicit rule artifact");
    assert(JSON.stringify(explicitArtifact.ruleSet.sources[0].callbackFieldNames) === JSON.stringify(["onPasswordChange"]), "explicit callback field should override multi-property anchor context");

    const ruleSet: TaintRuleSet = {
        schemaVersion: "2.0",
        sources: [generated],
        sinks: [],
        sanitizers: [],
        transfers: [],
    };
    const validation = validateRuleSet(ruleSet);
    assert(validation.valid, `generated callbackFieldNames rule should validate: ${validation.errors.join("; ")}`);

    let threw = false;
    try {
        buildSemanticFlowArtifact({
            ...anchor,
            callbackProperties: ["onTextChange", "onTap"],
        }, summary, "rule");
    } catch {
        threw = true;
    }
    assert(threw, "multi-callback proactive source must not emit a broad callback_param rule without fieldName");
}

async function assertConstructorLoweredComponentCallbackSource(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/harmony_component_property_callback");
    const scene = buildTestScene(sourceDir);

    const sourceRules: SourceRule[] = [
        {
            id: "source.project.constructor-dialog.confirm",
            sourceKind: "callback_param",
            match: {
                kind: "method_name_equals",
                value: "ConstructorDialog",
                argCount: 1,
            },
            target: { endpoint: "arg0" },
            callbackArgIndexes: [0],
            callbackFieldNames: ["confirm"],
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules([
        {
            id: "sink.fixture.host.sink",
            enabled: true,
            match: { kind: "method_name_equals", value: "sink" },
            target: { endpoint: "arg0" },
        },
    ]);
    assert(seedInfo.seedCount > 0, "method_name source rule should match constructor-lowered component calls by class name");
    assert(flows.length > 0, "constructor-lowered component callback source should reach sink");
}

async function main(): Promise<void> {
    prepareProject();
    assertArtifactCallbackFieldNames();

    assert(await detectFlow("positive", [FIELD_SCOPED_SOURCE_RULE]), "field-scoped source should seed the selected callback field");
    assert(!(await detectFlow("negative", [FIELD_SCOPED_SOURCE_RULE])), "field-scoped source must not seed sibling callback fields");
    assert(!(await detectFlow("positive", [BROAD_SOURCE_RULE])), "bare callback_param source cannot recover option-object callback fields");
    assert(await detectFlow("responseInterceptor", [RESPONSE_INTERCEPTOR_SOURCE_RULE]), "receiver typeHint should match method-style response interceptor callbacks");
    assert(await detectFlow("responseInterceptorWithCapture", [RESPONSE_INTERCEPTOR_SOURCE_RULE]), "callback_param arg0 should skip hidden closure carrier params and seed the visible callback value");
    assert(!(await detectFlow("requestInterceptor", [RESPONSE_INTERCEPTOR_SOURCE_RULE])), "receiver typeHint must not seed sibling request interceptor callbacks");
    await assertConstructorLoweredComponentCallbackSource();

    console.log("PASS test_callback_field_name_source_rule");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
