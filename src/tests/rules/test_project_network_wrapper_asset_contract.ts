import * as fs from "fs";
import * as path from "path";
import {
    validateAssetDocument,
    type AssetDocumentBase,
} from "../../core/assets/schema";
import type { RuleEndpointOrRef, SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readAsset(): AssetDocumentBase {
    const assetPath = path.resolve("src/models/project/clearchat/rules/semanticflow.rules.json");
    return JSON.parse(fs.readFileSync(assetPath, "utf8")) as AssetDocumentBase;
}

function endpointKey(endpoint: RuleEndpointOrRef | undefined): string {
    if (!endpoint) return "<missing>";
    if (typeof endpoint === "string") return endpoint;
    const suffix = endpoint.path && endpoint.path.length > 0 ? `.${endpoint.path.join(".")}` : "";
    const semantic = endpoint.semanticEndpointKind ? `#${endpoint.semanticEndpointKind}` : "";
    return `${endpoint.endpoint}${suffix}${semantic}`;
}

function decodedCanonicalId(rule: SinkRule | SourceRule): string {
    return decodeURIComponent(rule.match.value || "");
}

function hasProjectIdentity(rule: SinkRule | SourceRule, methodName: string, fileTail: string, className: string): boolean {
    if (rule.match.kind !== "canonical_api_id_equals") return false;
    const id = decodedCanonicalId(rule);
    return id.includes(`file=${fileTail}`)
        && id.includes(`decl=class:${className}`)
        && id.includes(`:${methodName}:`);
}

function assertScopedProjectRule(rule: SinkRule | SourceRule, fileTail: string, className: string): void {
    assert(rule.match.kind === "canonical_api_id_equals", `${rule.id} must use canonical identity`);
    assert(rule.apiEffect?.canonicalApiId === rule.match.value, `${rule.id} apiEffect canonical id mismatch`);
    const id = decodedCanonicalId(rule);
    assert(id.includes(`file=${fileTail}`), `${rule.id} canonical file drifted: ${id}`);
    assert(id.includes(`decl=class:${className}`), `${rule.id} canonical class drifted: ${id}`);
}

function sinksFor(sinks: SinkRule[], methodName: string, fileTail: string, className: string): SinkRule[] {
    return sinks.filter(rule => hasProjectIdentity(rule, methodName, fileTail, className));
}

function sourceFor(sources: SourceRule[], methodName: string, fileTail: string, className: string): SourceRule | undefined {
    return sources.find(rule => hasProjectIdentity(rule, methodName, fileTail, className));
}

function main(): void {
    const asset = readAsset();
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `ClearChat project wrapper asset invalid:\n${validation.errors.join("\n")}`);
    assert(asset.status === "reviewed", "project wrapper asset must be reviewed before trusted analysis loading");
    assert(asset.plane === "rule", "visible network wrapper semantics must remain rule-plane assets");
    assert(asset.provenance.source === "manual", "project wrapper asset must be source-audited manual provenance");
    assert(asset.provenance.projectId === "clearchat", "project wrapper asset must remain project-scoped");

    const lowered = lowerRuleAssetsToRuleSet([asset]);
    assert(lowered.diagnostics.length === 0, `unexpected lowering diagnostics:\n${lowered.diagnostics.join("\n")}`);

    const streamSinks = sinksFor(lowered.ruleSet.sinks, "sendStreamChatRequestV2", "ets/services/NetworkManagerV2.ets", "NetworkManagerV2");
    const sendChatSinks = sinksFor(lowered.ruleSet.sinks, "sendChatRequest", "ets/services/NetworkManagerV2.ets", "NetworkManagerV2");
    const searchSinks = sinksFor(lowered.ruleSet.sinks, "makeRequest", "ets/services/search/SearchService.ets", "SearchService");

    assert(streamSinks.length === 5, `expected 5 stream wrapper sink endpoints, got ${streamSinks.length}`);
    assert(sendChatSinks.length === 4, `expected 4 non-stream chat sink endpoints, got ${sendChatSinks.length}`);
    assert(searchSinks.length === 3, `expected 3 search wrapper sink endpoints, got ${searchSinks.length}`);

    for (const rule of streamSinks) {
        assertScopedProjectRule(rule, "ets/services/NetworkManagerV2.ets", "NetworkManagerV2");
    }
    for (const rule of sendChatSinks) {
        assertScopedProjectRule(rule, "ets/services/NetworkManagerV2.ets", "NetworkManagerV2");
    }
    for (const rule of searchSinks) {
        assertScopedProjectRule(rule, "ets/services/search/SearchService.ets", "SearchService");
    }

    const streamEndpoints = streamSinks.map(rule => endpointKey(rule.target)).sort();
    const sendChatEndpoints = sendChatSinks.map(rule => endpointKey(rule.target)).sort();
    const searchEndpoints = searchSinks.map(rule => endpointKey(rule.target)).sort();

    assert(
        JSON.stringify(streamEndpoints) === JSON.stringify(["arg0", "arg1", "arg2", "arg3", "arg4.tools"].sort()),
        `stream wrapper endpoints drifted: ${streamEndpoints.join(", ")}`,
    );
    assert(
        JSON.stringify(sendChatEndpoints) === JSON.stringify(["arg0", "arg1", "arg2", "arg3"].sort()),
        `sendChat endpoints drifted: ${sendChatEndpoints.join(", ")}`,
    );
    assert(
        JSON.stringify(searchEndpoints) === JSON.stringify(["arg0", "arg2", "arg3"].sort()),
        `search wrapper endpoints drifted: ${searchEndpoints.join(", ")}`,
    );
    assert(!streamEndpoints.includes("arg4"), "config object must not be modeled as a whole-argument sink");
    assert(!searchEndpoints.includes("arg1"), "HTTP method argument must not be modeled as a payload sink");
    assert(!searchEndpoints.includes("arg4"), "timeout argument must not be modeled as a payload sink");

    const sendChatSource = sourceFor(lowered.ruleSet.sources, "sendChatRequest", "ets/services/NetworkManagerV2.ets", "NetworkManagerV2");
    const searchSource = sourceFor(lowered.ruleSet.sources, "makeRequest", "ets/services/search/SearchService.ets", "SearchService");
    assert(sendChatSource, "sendChatRequest promise result source missing");
    assert(searchSource, "SearchService.makeRequest promise result source missing");
    assert(endpointKey(sendChatSource.target) === "result#promiseResult", "sendChatRequest source must target promiseResult");
    assert(endpointKey(searchSource.target) === "result#promiseResult", "SearchService.makeRequest source must target promiseResult");
    assertScopedProjectRule(sendChatSource, "ets/services/NetworkManagerV2.ets", "NetworkManagerV2");
    assertScopedProjectRule(searchSource, "ets/services/search/SearchService.ets", "SearchService");

    console.log("PASS test_project_network_wrapper_asset_contract");
}

main();
