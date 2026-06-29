import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { AssetDocumentBase, AssetEndpoint } from "../../core/assets/schema";
import { createAssetIdentityIndex } from "../../core/assets/schema";
import { buildCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import {
    createCanonicalApiRegistry,
    type CanonicalApiDescriptor,
} from "../../core/api/identity";
import { getSemanticEndpointResolutionRecords } from "../../core/kernel/contracts/PagNodeResolution";
import { TaintPropagationEngine, type TaintEngineOptions } from "../../core/orchestration/TaintPropagationEngine";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule } from "../../core/rules/RuleSchema";
import { collectCaseSeedNodes } from "../helpers/SyntheticCaseHarness";
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

const sinkEndpointArg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };
const sinkEndpointMissingArg1: AssetEndpoint = { base: { kind: "arg", index: 1 } };

const officialSinkDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.probe",
    logicalDeclarationFile: "api/@ohos.probe.d.ts",
    exportPath: [{ kind: "named" as const, name: "sendProbe" }],
    declarationOwner: {
        kind: "file" as const,
        path: ["file"],
        normalizedName: "file",
    },
    member: {
        kind: "function" as const,
        name: "sendProbe",
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "string" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.probe.d.ts" }],
    },
};

const officialSinkCanonicalApiId = buildCanonicalApiId(officialSinkDescriptorInput);
const officialSinkDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: officialSinkCanonicalApiId,
    ...officialSinkDescriptorInput,
};

function officialDescriptorForNamedFunction(methodName: string): CanonicalApiDescriptor {
    const descriptorInput = {
        ...officialSinkDescriptorInput,
        exportPath: [{ kind: "named" as const, name: methodName }],
        member: {
            kind: "function" as const,
            name: methodName,
        },
    };
    return {
        canonicalApiId: buildCanonicalApiId(descriptorInput),
        ...descriptorInput,
    };
}

function officialSinkAssetForDescriptor(
    assetId: string,
    descriptor: CanonicalApiDescriptor,
    endpoint: AssetEndpoint,
): AssetDocumentBase {
    return {
        id: assetId,
        plane: "rule",
        status: "official",
        surfaces: [{
            surfaceId: `${assetId}.surface.${descriptor.member.name}`,
            canonicalApiId: descriptor.canonicalApiId,
            kind: "invoke",
            confidence: "certain",
            provenance: {
                source: "sdk",
                location: { file: "api/@ohos.probe.d.ts", line: 1 },
            },
        }],
        bindings: [{
            bindingId: `${assetId}.binding.${descriptor.member.name}`,
            surfaceId: `${assetId}.surface.${descriptor.member.name}`,
            canonicalApiId: descriptor.canonicalApiId,
            assetId,
            plane: "rule",
            role: "sink",
            endpoint,
            effectTemplateRefs: [`${assetId}.template.${descriptor.member.name}`],
            semanticsFamily: "fixture.official_probe",
            completeness: "complete",
            confidence: "certain",
        }],
        effectTemplates: [{
            id: `${assetId}.template.${descriptor.member.name}`,
            kind: "rule.sink",
            value: endpoint,
            sinkKind: "fixture",
            confidence: "certain",
        }],
        provenance: { source: "manual" },
    };
}

function officialSinkAsset(assetId: string, endpoint: AssetEndpoint): AssetDocumentBase {
    return officialSinkAssetForDescriptor(assetId, officialSinkDescriptor, endpoint);
}

function buildFixture(repoRoot: string): void {
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(path.join(sourceDir, "SingletonProbe.ets"), [
        "import { sendProbe } from '@ohos.probe';",
        "",
        "class ProbeDispatcher {",
        "  run(value: string): void {",
        "    sendProbe(value);",
        "  }",
        "}",
        "",
        "const dispatcher = new ProbeDispatcher();",
        "export default dispatcher;",
        "",
    ].join("\n"));
    writeText(path.join(sourceDir, "EntryAbility.ets"), [
        "import { sendDebug, sendError, sendProbe } from '@ohos.probe';",
        "import dispatcher from './SingletonProbe';",
        "",
        "function relay(value: string): string {",
        "  return value;",
        "}",
        "",
        "async function asyncRelay(value: string): Promise<string> {",
        "  const returned = relay(value);",
        "  return Promise.resolve(returned);",
        "}",
        "",
        "function registerValue(value: string, cb: (payload: string) => void): void {",
        "  cb(value);",
        "}",
        "",
        "function registerPromiseValue(value: string): Promise<string> {",
        "  return Promise.resolve(value);",
        "}",
        "",
        "function parseTokenLine(line: string): string {",
        "  const parts = line.split('=');",
        "  return decodeURIComponent(parts[1]);",
        "}",
        "",
        "function sharedWrap(tag: string, args: string[]): string[] {",
        "  const out: string[] = [];",
        "  out.push(tag);",
        "  for (const item of args) {",
        "    out.push(item);",
        "  }",
        "  return out;",
        "}",
        "",
        "function logError(value: string): void {",
        "  const wrapped = sharedWrap('error', [value]);",
        "  sendError(wrapped[1]);",
        "}",
        "",
        "function logDebug(value: string): void {",
        "  const wrapped = sharedWrap('debug', [value]);",
        "  sendDebug(wrapped[1]);",
        "}",
        "",
        "function buildDto(value: string): { token: string, role: string } {",
        "  return {",
        "    token: value,",
        "    role: 'clean',",
        "  };",
        "}",
        "",
        "function readDtoToken(dto: { token: string, role: string }): string {",
        "  return dto.token;",
        "}",
        "",
        "class FieldRelay {",
        "  private slot: string = '';",
        "",
        "  capture(value: string): void {",
        "    this.slot = value;",
        "  }",
        "",
        "  flush(): void {",
        "    sendProbe(this.slot);",
        "  }",
        "}",
        "",
        "interface DispatchTarget {",
        "  handle(value: string): void;",
        "}",
        "",
        "class TaintedDispatchTarget implements DispatchTarget {",
        "  handle(value: string): void {",
        "    sendProbe(value);",
        "  }",
        "}",
        "",
        "class CleanDispatchTarget implements DispatchTarget {",
        "  handle(_value: string): void {",
        "    sendProbe('clean');",
        "  }",
        "}",
        "",
        "function chooseTarget(flag: boolean): DispatchTarget {",
        "  if (flag) {",
        "    return new TaintedDispatchTarget();",
        "  }",
        "  return new CleanDispatchTarget();",
        "}",
        "",
        "function unknownFlag(): boolean {",
        "  return Date.now() > 0;",
        "}",
        "",
        "export function endpoint_projection_probe_T(taint_src: string): void {",
        "  sendProbe(taint_src);",
        "}",
        "",
        "export function return_assignment_probe_T(taint_src: string): void {",
        "  const viaReturn = relay(taint_src);",
        "  sendProbe(viaReturn);",
        "}",
        "",
        "export async function promise_await_result_probe_T(taint_src: string): Promise<void> {",
        "  const pending = asyncRelay(taint_src);",
        "  const viaAwait = await pending;",
        "  sendProbe(viaAwait);",
        "}",
        "",
        "export function callback_invocation_probe_T(taint_src: string): void {",
        "  registerValue(taint_src, (payload: string): void => {",
        "    sendProbe(payload);",
        "  });",
        "}",
        "",
        "export function promise_then_callback_probe_T(taint_src: string): void {",
        "  registerPromiseValue(taint_src).then((payload: string): void => {",
        "    sendProbe(payload);",
        "  });",
        "}",
        "",
        "export function this_field_probe_T(taint_src: string): void {",
        "  const carrier = new FieldRelay();",
        "  carrier.capture(taint_src);",
        "  carrier.flush();",
        "}",
        "",
        "export function dto_object_field_probe_T(taint_src: string): void {",
        "  const dto = buildDto(taint_src);",
        "  const token = readDtoToken(dto);",
        "  sendProbe(token);",
        "}",
        "",
        "export function array_higher_order_probe_T(taint_src: string): void {",
        "  const sourceValues: string[] = [];",
        "  sourceValues.push(taint_src);",
        "  sourceValues.push('clean');",
        "  const mapped = sourceValues.map((item: string): string => `${item}`);",
        "  const selected = mapped.filter((item: string): boolean => item.length > 0);",
        "  sendProbe(selected[0]);",
        "}",
        "",
        "export function object_literal_array_property_probe_T(taint_src: string): void {",
        "  const episodes: string[] = [];",
        "  episodes.push(taint_src);",
        "  const box: { list: string[] } = { list: episodes };",
        "  sendProbe(box.list[0]);",
        "}",
        "",
        "export function object_literal_array_property_probe_F(taint_src: string): void {",
        "  const episodes: string[] = [];",
        "  episodes.push('clean');",
        "  const box: { list: string[] } = { list: episodes };",
        "  sendProbe(box.list[0]);",
        "  void taint_src;",
        "}",
        "",
        "export function map_set_slot_probe_T(taint_src: string): void {",
        "  const map = new Map<string, string>();",
        "  map.set('map-key', taint_src);",
        "  const mapped = map.get('map-key')!;",
        "  const set = new Set<string>();",
        "  set.add(mapped);",
        "  const values = Array.from(set.values());",
        "  sendProbe(values[0]);",
        "}",
        "",
        "export function json_string_url_parser_probe_T(taint_src: string): void {",
        "  const dto = { token: taint_src, role: 'clean' };",
        "  const json = JSON.stringify(dto);",
        "  const parsed = JSON.parse(json);",
        "  const line = `token=${encodeURIComponent(parsed.token)}`;",
        "  const decoded = parseTokenLine(line);",
        "  sendProbe(decoded);",
        "}",
        "",
        "export function singleton_default_export_receiver_probe_T(taint_src: string): void {",
        "  dispatcher.run(taint_src);",
        "}",
        "",
        "export function shared_helper_context_probe_T(taint_src: string): void {",
        "  logError(taint_src);",
        "  logDebug('clean');",
        "}",
        "",
        "export function virtual_dispatch_unresolved_probe_F(taint_src: string): void {",
        "  const target = chooseTarget(unknownFlag());",
        "  target.handle(taint_src);",
        "}",
        "",
        "export function endpoint_missing_probe_F(taint_src: string): void {",
        "  sendProbe(taint_src);",
        "}",
        "",
    ].join("\n"));
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function findMethod(scene: Scene, name: string): ArkMethod {
    const candidates = scene.getMethods().filter(method => method.getName?.() === name);
    assert(candidates.length === 1, `expected one method named ${name}, got ${candidates.length}`);
    return candidates[0];
}

function buildEngineOptionsForDescriptors(
    asset: AssetDocumentBase,
    descriptors: readonly CanonicalApiDescriptor[] = [officialSinkDescriptor],
): TaintEngineOptions {
    const registry = createCanonicalApiRegistry(descriptors);
    const assetIdentityIndex = createAssetIdentityIndex({ canonicalApiRegistry: registry });
    assetIdentityIndex.addAsset(asset);
    return {
        apiAssets: [asset],
        assetIdentityIndex,
        canonicalApiRegistry: registry,
        includeBuiltinModules: false,
    };
}

function buildEngineOptions(asset: AssetDocumentBase): TaintEngineOptions {
    return buildEngineOptionsForDescriptors(asset);
}

async function runProbe(input: {
    scene: Scene;
    entryName: string;
    sinkRules: SinkRule[];
    engineOptions: TaintEngineOptions;
    expectFlow: boolean;
    expectedCanonicalApiId?: string;
    captureLogs?: boolean;
}): Promise<{
    flowCount: number;
    logs: string[];
    endpointStatuses: string[];
}> {
    const entryMethod = findMethod(input.scene, input.entryName);
    const logs: string[] = [];
    const originalLog = console.log;
    if (input.captureLogs) {
        console.log = (...args: unknown[]): void => {
            logs.push(args.map(item => String(item)).join(" "));
        };
    }
    try {
        const engine = new TaintPropagationEngine(input.scene, 1, input.engineOptions);
        engine.verbose = input.captureLogs === true;
        await engine.buildPAG({
            entryModel: "explicit",
            syntheticEntryMethods: [entryMethod],
        });
        const expectedCanonicalApiId = input.expectedCanonicalApiId || officialSinkCanonicalApiId;
        const ledger = engine.getOfficialOccurrenceLedger();
        const acceptedOfficial = ledger.filter(record =>
            record.status === "accepted" && record.canonicalApiId === expectedCanonicalApiId
        );
        assert(acceptedOfficial.length > 0, `${input.entryName} should have an accepted official occurrence ${expectedCanonicalApiId}`);
        const seeds = collectCaseSeedNodes(engine, entryMethod, {
            sourceLocalNames: [],
            includeParameterLocals: true,
        });
        assert(seeds.length > 0, `${input.entryName} should expose a seedable entry parameter`);
        engine.propagateWithSeeds(seeds);
        const flows = engine.detectSinksByRules(input.sinkRules, { maxFlowsPerEntry: 10 });
        const endpointRecords = getSemanticEndpointResolutionRecords(engine.pag)
            .filter(record => record.canonicalApiId === expectedCanonicalApiId);
        if (input.expectFlow) {
            assert(flows.length > 0, `${input.entryName} should produce a flow`);
            assert(
                flows.some(flow => flow.sinkEndpoint === "arg0" && flow.sinkNodeId !== undefined),
                `${input.entryName} should resolve official sink arg0 to a concrete PAG node`,
            );
            assert(
                endpointRecords.some(record => record.status === "resolved" && record.endpointPath === "arg0" && record.nodeIds.length > 0),
                `${input.entryName} should have resolved endpoint projection record for arg0`,
            );
        } else {
            assert(flows.length === 0, `${input.entryName} should not produce a flow, got ${flows.length}`);
        }
        return {
            flowCount: flows.length,
            logs,
            endpointStatuses: endpointRecords.map(record => `${record.endpointPath}:${record.status}:${record.diagnosticKind || record.reason}`),
        };
    } finally {
        if (input.captureLogs) {
            console.log = originalLog;
        }
    }
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "official_closure_focused_probes");
    const repoRoot = resolveTestRunPath("analyze", "official_closure_focused_probes", "fixtures", "repo");
    fs.rmSync(root, { recursive: true, force: true });
    buildFixture(repoRoot);

    const scene = buildScene(repoRoot);
    const goodAsset = officialSinkAsset("asset.fixture.official_probe.arg0_sink", sinkEndpointArg0);
    const goodLowered = lowerRuleAssetsToRuleSet([goodAsset]);
    assert(goodLowered.diagnostics.length === 0, `unexpected good asset diagnostics: ${goodLowered.diagnostics.join("; ")}`);
    assert(goodLowered.ruleSet.sinks.length === 1, "good official sink asset should lower to one sink rule");
    const goodOptions = buildEngineOptions(goodAsset);

    const positiveEntries = [
        "endpoint_projection_probe_T",
        "return_assignment_probe_T",
        "promise_await_result_probe_T",
        "callback_invocation_probe_T",
        "promise_then_callback_probe_T",
        "this_field_probe_T",
        "dto_object_field_probe_T",
        "array_higher_order_probe_T",
        "object_literal_array_property_probe_T",
        "map_set_slot_probe_T",
        "json_string_url_parser_probe_T",
        "singleton_default_export_receiver_probe_T",
    ];
    const positiveResults: Array<{ entry: string; flows: number; endpoints: string[] }> = [];
    const failures: string[] = [];
    for (const entryName of positiveEntries) {
        try {
            const result = await runProbe({
                scene,
                entryName,
                sinkRules: goodLowered.ruleSet.sinks,
                engineOptions: goodOptions,
                expectFlow: true,
            });
            positiveResults.push({ entry: entryName, flows: result.flowCount, endpoints: result.endpointStatuses });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${entryName}: ${message}`);
            positiveResults.push({ entry: entryName, flows: 0, endpoints: [`FAIL:${message}`] });
        }
    }

    let virtualNegative: Awaited<ReturnType<typeof runProbe>> | undefined;
    try {
        virtualNegative = await runProbe({
            scene,
            entryName: "virtual_dispatch_unresolved_probe_F",
            sinkRules: goodLowered.ruleSet.sinks,
            engineOptions: goodOptions,
            expectFlow: false,
            captureLogs: true,
        });
        assert(
            virtualNegative.logs.some(line => line.includes("virtual_dispatch_unresolved")),
            "virtual dispatch negative should emit virtual_dispatch_unresolved instead of connecting all same-name methods",
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`virtual_dispatch_unresolved_probe_F: ${message}`);
    }

    let objectLiteralNegative: Awaited<ReturnType<typeof runProbe>> | undefined;
    try {
        objectLiteralNegative = await runProbe({
            scene,
            entryName: "object_literal_array_property_probe_F",
            sinkRules: goodLowered.ruleSet.sinks,
            engineOptions: goodOptions,
            expectFlow: false,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`object_literal_array_property_probe_F: ${message}`);
    }

    const errorDescriptor = officialDescriptorForNamedFunction("sendError");
    const debugDescriptor = officialDescriptorForNamedFunction("sendDebug");
    const errorAsset = officialSinkAssetForDescriptor("asset.fixture.official_probe.error_sink", errorDescriptor, sinkEndpointArg0);
    const debugAsset = officialSinkAssetForDescriptor("asset.fixture.official_probe.debug_sink", debugDescriptor, sinkEndpointArg0);
    const errorLowered = lowerRuleAssetsToRuleSet([errorAsset]);
    const debugLowered = lowerRuleAssetsToRuleSet([debugAsset]);
    assert(errorLowered.diagnostics.length === 0, `unexpected error asset diagnostics: ${errorLowered.diagnostics.join("; ")}`);
    assert(debugLowered.diagnostics.length === 0, `unexpected debug asset diagnostics: ${debugLowered.diagnostics.join("; ")}`);
    let sharedHelperError: Awaited<ReturnType<typeof runProbe>> | undefined;
    let sharedHelperDebug: Awaited<ReturnType<typeof runProbe>> | undefined;
    try {
        sharedHelperError = await runProbe({
            scene,
            entryName: "shared_helper_context_probe_T",
            sinkRules: errorLowered.ruleSet.sinks,
            engineOptions: buildEngineOptionsForDescriptors(errorAsset, [errorDescriptor, debugDescriptor]),
            expectedCanonicalApiId: errorDescriptor.canonicalApiId,
            expectFlow: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`shared_helper_context_probe_T/sendError: ${message}`);
    }
    try {
        sharedHelperDebug = await runProbe({
            scene,
            entryName: "shared_helper_context_probe_T",
            sinkRules: debugLowered.ruleSet.sinks,
            engineOptions: buildEngineOptionsForDescriptors(debugAsset, [errorDescriptor, debugDescriptor]),
            expectedCanonicalApiId: debugDescriptor.canonicalApiId,
            expectFlow: false,
            captureLogs: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`shared_helper_context_probe_T/sendDebug: ${message}`);
    }

    const missingAsset = officialSinkAsset("asset.fixture.official_probe.arg1_missing_sink", sinkEndpointMissingArg1);
    const missingLowered = lowerRuleAssetsToRuleSet([missingAsset]);
    assert(missingLowered.diagnostics.length === 0, `unexpected missing-endpoint asset diagnostics: ${missingLowered.diagnostics.join("; ")}`);
    assert(missingLowered.ruleSet.sinks.length === 1, "missing endpoint asset should lower to one sink rule");
    let missingResult: Awaited<ReturnType<typeof runProbe>> | undefined;
    try {
        missingResult = await runProbe({
            scene,
            entryName: "endpoint_missing_probe_F",
            sinkRules: missingLowered.ruleSet.sinks,
            engineOptions: buildEngineOptions(missingAsset),
            expectFlow: false,
        });
        assert(
            missingResult.endpointStatuses.some(status =>
                status.startsWith("arg1:")
                && status.includes("asset_endpoint_error")
            ),
            "missing endpoint probe should record asset_endpoint_error for arg1",
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`endpoint_missing_probe_F: ${message}`);
    }

    if (failures.length === 0) {
        console.log("PASS test_official_closure_focused_probes");
    } else {
        console.log("FAIL test_official_closure_focused_probes");
    }
    for (const item of positiveResults) {
        console.log(`${item.entry}_flows=${item.flows}`);
        console.log(`${item.entry}_endpoints=${item.endpoints.join(",")}`);
    }
    console.log(`virtual_dispatch_unresolved_logged=${virtualNegative?.logs.some(line => line.includes("virtual_dispatch_unresolved")) || false}`);
    console.log(`object_literal_array_property_negative_flows=${objectLiteralNegative?.flowCount ?? "not_run"}`);
    console.log(`shared_helper_error_flows=${sharedHelperError?.flowCount ?? "not_run"}`);
    console.log(`shared_helper_debug_flows=${sharedHelperDebug?.flowCount ?? "not_run"}`);
    console.log(`endpoint_missing_statuses=${missingResult?.endpointStatuses.join(",") || "not_run"}`);
    if (failures.length > 0) {
        for (const failure of failures) {
            console.log(`failure=${failure}`);
        }
        throw new Error(`focused probes failed: ${failures.join(" | ")}`);
    }
}

main().catch(error => {
    console.error("FAIL test_official_closure_focused_probes");
    console.error(error);
    process.exitCode = 1;
});
