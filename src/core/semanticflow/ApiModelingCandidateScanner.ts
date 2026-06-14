import * as fs from "fs";
import * as path from "path";
import { ARK_MAIN_FRAMEWORK_CALLBACK_METHOD_NAMES } from "../entry/arkmain/catalog/ArkMainFrameworkCatalog";
import {
    resolveAbilityLifecycleContract,
    resolveExtensionLifecycleContract,
    resolveStageLifecycleContract,
} from "../entry/arkmain/facts/ArkMainLifecycleContracts";
import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";

export interface ApiModelingCandidateScannerOptions {
    maxCandidates?: number;
}

interface ImportBinding {
    source: string;
    resolvedFile?: string;
}

interface CandidateAccumulator {
    item: NormalizedCallsiteItem;
    tier: ApiModelingCandidateTier;
    reasons: string[];
    originalIndex: number;
}

interface MethodCandidate {
    owner?: string;
    baseOwner?: string;
    method: string;
    isStatic: boolean;
    argCount: number;
    paramNames: string[];
    returnType?: string;
    startLine: number;
    code: string;
}

interface SourceFileText {
    absFile: string;
    relFile: string;
    text: string;
}

interface DeclaredOwnerCallsiteHint {
    method: string;
    declaredOwner: string;
    receiver: string;
    callerFile: string;
    invokeLine: number;
    invokeStmtText: string;
    windowLines: string;
}

interface DirectBoundaryCallsite {
    receiver: string;
    declaredOwner: string;
    method: string;
    invokeKind: NormalizedCallsiteItem["invokeKind"];
    start: number;
    statementText: string;
    argCount: number;
    importSource: string;
    resolvedFile?: string;
}

type ApiModelingCandidateTier =
    | "direct-boundary"
    | "project-wrapper"
    | "declared-owner-wrapper"
    | "returned-value-wrapper"
    | "callback-payload";

interface ProjectApiWrapperClassification {
    eligible: boolean;
    tier: ApiModelingCandidateTier;
    reasons: string[];
}

const API_MODELING_TIER_ORDER: ApiModelingCandidateTier[] = [
    "direct-boundary",
    "declared-owner-wrapper",
    "project-wrapper",
    "returned-value-wrapper",
    "callback-payload",
];

function apiModelingTierIndex(tier: ApiModelingCandidateTier): number {
    const index = API_MODELING_TIER_ORDER.indexOf(tier);
    return index >= 0 ? index : API_MODELING_TIER_ORDER.length;
}

const OFFICIAL_ARKUI_COMPONENTS = new Set([
    "Button",
    "Checkbox",
    "Column",
    "ForEach",
    "Grid",
    "Image",
    "List",
    "ListItem",
    "Navigation",
    "Row",
    "Scroll",
    "Search",
    "Select",
    "Slider",
    "Stepper",
    "Swiper",
    "Tabs",
    "Text",
    "TextArea",
    "TextInput",
    "Toggle",
]);

const SKIP_DIRS = new Set([
    ".git",
    ".hvigor",
    ".ohos",
    "build",
    "node_modules",
    "oh_modules",
    "out",
    "output",
    "tmp",
]);

const DATA_ENDPOINT_TOKEN_RE = /\b(payload|body|data|message|msg|content|text|value|values?|params?|query|header|authorization|token|password|passwd|credential|secret|cookie|file|buffer|record|url|uri|server|address|host|endpoint|user|username|key|path)\b/i;
const STRUCTURAL_EFFECT_METHOD_RE = /\.\s*[A-Za-z_$][\w$]*\s*\(/;

function normalizeSlashes(value: string): string {
    return String(value || "").replace(/\\/g, "/");
}

export function discoverApiCallbackModelingCandidates(
    repoRoot: string,
    sourceDirs: string[],
    options: ApiModelingCandidateScannerOptions = {},
): NormalizedCallsiteItem[] {
    const maxCandidates = Math.max(0, options.maxCandidates ?? 100);
    if (maxCandidates === 0) {
        return [];
    }
    const sourceFiles = collectSourceFiles(repoRoot, sourceDirs);
    const byKey = new Map<string, CandidateAccumulator>();
    for (const absFile of sourceFiles) {
        const relFile = normalizeSlashes(path.relative(repoRoot, absFile));
        const text = readText(absFile);
        if (!text) continue;
        const imports = collectImportBindings(repoRoot, absFile, text);
        for (const call of collectOptionCallbackCalls(text)) {
            if (OFFICIAL_ARKUI_COMPONENTS.has(call.callee)) continue;
            const callbackProperties = call.callbackProperties.filter(isModelingRelevantCallback);
            if (callbackProperties.length === 0) continue;
            const binding = imports.get(call.callee);
            const sourceFile = binding?.resolvedFile || relFile;
            const key = `${call.callee}|${sourceFile}|${callbackProperties.join(",")}`;
            const existing = byKey.get(key);
            const contextSlice = {
                callerFile: relFile,
                invokeLine: lineNumberAt(text, call.start),
                invokeStmtText: compactWhitespace(call.statementText).slice(0, 500),
                windowLines: formatLineWindow(text, lineNumberAt(text, call.start), 4),
                cfgNeighborStmts: [],
            };
            if (existing) {
                existing.item.count = (existing.item.count || 1) + 1;
                const slices = Array.isArray((existing.item as any).contextSlices)
                    ? (existing.item as any).contextSlices as unknown[]
                    : [];
                if (slices.length < 3) {
                    (existing.item as any).contextSlices = [...slices, contextSlice];
                }
                continue;
            }
            const ownerSnippet = binding?.resolvedFile
                ? readExportedSymbolSnippet(repoRoot, binding.resolvedFile, call.callee)
                : undefined;
            byKey.set(key, {
                tier: "callback-payload",
                reasons: buildCallbackCandidateReasons(call.callee, callbackProperties, binding),
                originalIndex: byKey.size,
                item: {
                    callee_signature: binding?.resolvedFile
                        ? buildResolvedCallbackSurfaceSignature(binding.resolvedFile, call.callee)
                        : `@%unk/%unk: .${call.callee}()`,
                    method: call.callee,
                    invokeKind: "static",
                    argCount: 1,
                    sourceFile,
                    count: 1,
                    topEntries: [
                        ...(binding?.resolvedFile ? [
                            `resolvedCallbackOwnerFile=${binding.resolvedFile}`,
                            "callbackOwnerResolved=true",
                        ] : []),
                    ],
                    candidateOrigin: "recall_callback_surface",
                    callbackProperties,
                    importSource: binding?.source,
                    methodSnippet: ownerSnippet,
                    methodSnippetSource: ownerSnippet ? "recall_callback_owner_import" : undefined,
                    callerFiles: [relFile],
                    contextSlices: [contextSlice],
                } as NormalizedCallsiteItem,
            });
        }
        for (const call of collectMethodCallbackCalls(text)) {
            const receiverRoot = receiverRootIdentifier(call.receiver);
            const receiverBinding = receiverRoot ? imports.get(receiverRoot) : undefined;
            const receiverMethodEvidence = resolveImportedReceiverMethodEvidence(repoRoot, receiverBinding?.resolvedFile, receiverRoot, call.method);
            const sourceFile = receiverBinding?.resolvedFile || relFile;
            const key = `${call.method}|${sourceFile}|${call.receiver}|${call.callbackArgIndexes.join(",")}`;
            const existing = byKey.get(key);
            const contextSlice = {
                callerFile: relFile,
                invokeLine: lineNumberAt(text, call.start),
                invokeStmtText: compactWhitespace(call.statementText).slice(0, 500),
                windowLines: formatLineWindow(text, lineNumberAt(text, call.start), 4),
                cfgNeighborStmts: [],
            };
            if (existing) {
                existing.item.count = (existing.item.count || 1) + 1;
                const slices = Array.isArray((existing.item as any).contextSlices)
                    ? (existing.item as any).contextSlices as unknown[]
                    : [];
                if (slices.length < 3) {
                    (existing.item as any).contextSlices = [...slices, contextSlice];
                }
                continue;
            }
            byKey.set(key, {
                tier: "callback-payload",
                reasons: buildMethodCallbackCandidateReasons(call),
                originalIndex: byKey.size,
                item: {
                    callee_signature: receiverMethodEvidence
                        ? buildProjectApiWrapperSignature(sourceFile, receiverMethodEvidence, receiverMethodEvidence.owner || receiverRoot)
                        : `@%unk/%unk: .${call.method}(${Array.from({ length: call.argCount }, () => "Unknown").join(", ")})`,
                    method: call.method,
                    invokeKind: receiverMethodEvidence?.isStatic ? "static" : "instance",
                    argCount: call.argCount,
                    sourceFile,
                    count: 1,
                    topEntries: [
                        `origin=recall_method_callback_surface`,
                        `receiver=${call.receiver}`,
                        `callbackArgIndexes=${call.callbackArgIndexes.join(",")}`,
                        ...(call.typeHint ? [`typeHint=${call.typeHint}`] : []),
                        ...(receiverRoot ? [`receiverRoot=${receiverRoot}`] : []),
                        ...(receiverBinding?.source ? [`importSource=${receiverBinding.source}`] : []),
                        ...(receiverBinding?.resolvedFile ? [`resolvedReceiverFile=${receiverBinding.resolvedFile}`] : []),
                        ...(receiverMethodEvidence?.owner ? [`resolvedReceiverOwner=${receiverMethodEvidence.owner}`] : []),
                    ],
                    candidateOrigin: "recall_method_callback_surface",
                    callbackArgIndexes: call.callbackArgIndexes,
                    typeHint: call.typeHint,
                    importSource: receiverBinding?.source,
                    methodSnippet: receiverMethodEvidence?.code,
                    methodSnippetSource: receiverMethodEvidence ? "recall_method_callback_receiver_import" : undefined,
                    callerFiles: [relFile],
                    contextSlices: [contextSlice],
                } as NormalizedCallsiteItem,
            });
        }
    }
    return [...byKey.values()]
        .sort(compareApiModelingCandidateAccumulators)
        .slice(0, maxCandidates)
        .map(entry => entry.item);
}

function buildMethodCallbackCandidateReasons(call: MethodCallbackCall): string[] {
    const lowered = `${call.receiver}.${call.method}`.toLowerCase();
    const reasons = ["method-callback-argument"];
    if (lowered.includes("interceptors")) reasons.push("interceptor-callback");
    if (/\b(response|request|error)\b/.test(lowered)) reasons.push("request-response-callback");
    if (hasAnyReceiverToken(call.receiver, ["event", "emitter", "bus", "channel", "manager", "hub"])) {
        reasons.push("receiver-callback-channel");
    }
    if (call.method === "use") reasons.push("middleware-callback");
    return reasons;
}

function receiverRootIdentifier(receiver: string): string | undefined {
    const text = String(receiver || "").trim();
    const m = text.match(/^([A-Za-z_$][\w$]*)/);
    return m ? m[1] : undefined;
}

function resolveImportedReceiverMethodEvidence(
    repoRoot: string,
    resolvedFile: string | undefined,
    receiverRoot: string | undefined,
    methodName: string,
): MethodCandidate | undefined {
    if (!resolvedFile || !receiverRoot || !methodName) {
        return undefined;
    }
    const absFile = path.resolve(repoRoot, resolvedFile);
    const text = readText(absFile);
    if (!text) {
        return undefined;
    }
    const methods = collectProjectApiWrapperMethods(text);
    return methods.find(method =>
        method.method === methodName
        && (!method.owner || method.owner === receiverRoot));
}

function buildCallbackCandidateReasons(
    callee: string,
    callbackProperties: string[],
    binding?: ImportBinding,
): string[] {
    const reasons = ["option-callback-property"];
    if (/(field|input|search|textarea|form)/i.test(callee)) reasons.push("ui-input-callback");
    if (/(change|input|submit|search|phone|password|code|value|text)/i.test(callbackProperties.join(" "))) {
        reasons.push("payload-named-callback");
    }
    if (/(click|tap|press|btn)/i.test(callbackProperties.join(" "))) reasons.push("activation-callback");
    if (binding?.source && !binding.source.startsWith(".")) reasons.push("external-component-import");
    if (binding?.resolvedFile) reasons.push("resolved-callback-owner-file");
    return reasons;
}

function buildResolvedCallbackSurfaceSignature(sourceFile: string, callee: string): string {
    return `@${normalizeSlashes(sourceFile)}: ${callee}(Unknown)`;
}

export function discoverApiSurfaceModelingCandidates(
    repoRoot: string,
    sourceDirs: string[],
    options: ApiModelingCandidateScannerOptions = {},
): NormalizedCallsiteItem[] {
    const maxCandidates = Math.max(0, options.maxCandidates ?? 100);
    if (maxCandidates === 0) {
        return [];
    }
    const sourceFiles = collectSourceFiles(repoRoot, sourceDirs);
    const sourceTexts = readSourceFileTexts(repoRoot, sourceFiles);
    const declaredOwnerHintsByMethod = collectDeclaredOwnerCallsiteHints(sourceTexts);
    const out: CandidateAccumulator[] = [];
    for (const { relFile, text } of sourceTexts) {
        for (const call of collectDirectBoundaryCallsites(repoRoot, relFile, text)) {
            const invokeLine = lineNumberAt(text, call.start);
            out.push({
                tier: "direct-boundary",
                reasons: buildDirectBoundaryCallsiteReasons(relFile, call),
                originalIndex: out.length,
                item: {
                    callee_signature: buildDirectBoundaryCallsiteSignature(relFile, call),
                    method: call.method,
                    invokeKind: call.invokeKind,
                    argCount: call.argCount,
                    sourceFile: relFile,
                    count: 1,
                    topEntries: [
                        "origin=recall_direct_boundary_surface",
                        "candidateTier=direct-boundary",
                        "candidateBoundary=direct_project_or_third_party_callsite_evidence",
                        `receiver=${call.receiver}`,
                        `declaredOwner=${call.declaredOwner}`,
                        `importSource=${call.importSource}`,
                        ...(call.resolvedFile ? [`resolvedImportFile=${call.resolvedFile}`] : []),
                        ...(call.resolvedFile ? ["directBoundaryResolvedImport=true"] : []),
                        ...(call.invokeKind === "any" ? ["directBoundaryNamespaceOwnerCallsite=true"] : []),
                        `directBoundaryCallsite=${relFile}:${invokeLine}`,
                    ],
                    candidateOrigin: "recall_direct_boundary_surface",
                    methodSnippet: formatLineWindow(text, invokeLine, 6),
                    methodSnippetSource: "recall_direct_boundary_callsite",
                    importSource: call.importSource,
                    contextSlices: [{
                        callerFile: relFile,
                        callerMethod: "-",
                        invokeLine,
                        invokeStmtText: compactWhitespace(call.statementText).slice(0, 500),
                        windowLines: formatLineWindow(text, invokeLine, 6),
                        cfgNeighborStmts: [],
                    }],
                } as NormalizedCallsiteItem,
            });
        }
        if (!text || !isLikelyProjectApiWrapperFile(relFile, text)) {
            continue;
        }
        for (const method of collectProjectApiWrapperMethods(text)) {
            const classification = classifyProjectApiWrapperMethod(relFile, method);
            if (!classification.eligible) {
                continue;
            }
            const sourceFile = relFile;
            const baseItem = {
                callee_signature: buildProjectApiWrapperSignature(relFile, method),
                method: method.method,
                invokeKind: method.isStatic ? "static" : "instance",
                argCount: method.argCount,
                sourceFile,
                count: 1,
                topEntries: [
                    `origin=recall_api_surface`,
                    `candidateTier=${classification.tier}`,
                    ...classification.reasons.map(reason => `candidateReason=${reason}`),
                    ...candidateBoundaryHints(relFile, method),
                ],
                candidateOrigin: "recall_api_surface",
                methodSnippet: method.code,
                methodSnippetSource: "recall_api_surface",
                returnType: method.returnType,
                contextSlices: [{
                    callerFile: relFile,
                    callerMethod: method.owner ? `${method.owner}.${method.method}` : method.method,
                    invokeLine: method.startLine,
                    invokeStmtText: firstMeaningfulLine(method.code),
                    windowLines: method.code,
                    cfgNeighborStmts: [],
                }],
            } as NormalizedCallsiteItem;
            out.push({
                tier: classification.tier,
                reasons: classification.reasons,
                originalIndex: out.length,
                item: baseItem,
            });
            for (const declaredOwnerCandidate of buildDeclaredOwnerSurfaceCandidates(baseItem, method, declaredOwnerHintsByMethod.get(method.method) || [])) {
                out.push({
                    tier: "declared-owner-wrapper",
                    reasons: [...classification.reasons, "analyzer-backed-declared-owner"],
                    originalIndex: out.length,
                    item: declaredOwnerCandidate,
                });
            }
            if (shouldCreateReturnedValueSurfaceCandidate(method)) {
                out.push({
                    tier: "returned-value-wrapper",
                    reasons: [...classification.reasons, "returned-value-surface"],
                    originalIndex: out.length,
                    item: {
                        ...baseItem,
                        topEntries: [
                            ...((baseItem.topEntries || []) as string[]),
                            "semanticFocus=returned_value_surface",
                        ],
                        candidateOrigin: "recall_returned_value_surface",
                        semanticFocus: "returned_value_surface",
                    } as NormalizedCallsiteItem,
                });
            }
        }
    }
    return selectApiSurfaceCandidateAccumulators(out, maxCandidates)
        .map(entry => entry.item);
}

function readSourceFileTexts(repoRoot: string, sourceFiles: string[]): SourceFileText[] {
    const out: SourceFileText[] = [];
    for (const absFile of sourceFiles) {
        const text = readText(absFile);
        if (!text) {
            continue;
        }
        out.push({
            absFile,
            relFile: normalizeSlashes(path.relative(repoRoot, absFile)),
            text,
        });
    }
    return out;
}

function collectDeclaredOwnerCallsiteHints(sourceTexts: SourceFileText[]): Map<string, DeclaredOwnerCallsiteHint[]> {
    const byMethod = new Map<string, DeclaredOwnerCallsiteHint[]>();
    for (const source of sourceTexts) {
        const typedReceivers = collectTypedReceivers(source.text);
        if (typedReceivers.size === 0) {
            continue;
        }
        for (const [receiver, declaredOwner] of typedReceivers.entries()) {
            const receiverPattern = new RegExp(`\\b(?:this\\.)?${escapeRegExp(receiver)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, "g");
            for (const match of source.text.matchAll(receiverPattern)) {
                const method = match[1];
                if (!method || shouldIgnoreDeclaredOwnerMethod(method)) {
                    continue;
                }
                const invokeLine = lineNumberAt(source.text, match.index || 0);
                const hint: DeclaredOwnerCallsiteHint = {
                    method,
                    declaredOwner,
                    receiver,
                    callerFile: source.relFile,
                    invokeLine,
                    invokeStmtText: lineTextAt(source.text, invokeLine),
                    windowLines: formatLineWindow(source.text, invokeLine, 3),
                };
                const group = byMethod.get(method) || [];
                if (!group.some(existing => declaredOwnerHintKey(existing) === declaredOwnerHintKey(hint))) {
                    group.push(hint);
                }
                byMethod.set(method, group);
            }
        }
    }
    return byMethod;
}

function collectDirectBoundaryCallsites(repoRoot: string, relFile: string, text: string): DirectBoundaryCallsite[] {
    if (!text || !isProjectPageOrComponentFile(relFile)) {
        return [];
    }
    const imports = collectImportBindings(repoRoot, path.resolve(repoRoot, relFile), text);
    const boundaryOwners = collectBoundaryImportedOwnerSources(imports);
    if (boundaryOwners.size === 0) {
        return [];
    }
    const typedReceivers = collectTypedReceivers(text);
    const out: DirectBoundaryCallsite[] = [];
    for (const [receiver, declaredOwner] of typedReceivers.entries()) {
        const binding = boundaryOwners.get(declaredOwner);
        const importSource = binding?.source;
        if (!binding || !importSource) {
            continue;
        }
        const receiverPattern = new RegExp(`\\b(?:this\\.)?${escapeRegExp(receiver)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, "g");
        for (const match of text.matchAll(receiverPattern)) {
            const method = match[1];
            if (!method || shouldIgnoreDirectBoundaryMethod(method)) {
                continue;
            }
            const openParen = text.indexOf("(", (match.index || 0) + match[0].lastIndexOf(method));
            if (openParen < 0) {
                continue;
            }
            const closeParen = findMatchingParen(text, openParen);
            if (closeParen < 0) {
                continue;
            }
            const argsText = text.slice(openParen + 1, closeParen);
            const args = splitTopLevelArguments(argsText);
            if (!hasModelableDirectCallShape(method, argsText, args.length)) {
                continue;
            }
            if (binding.resolvedFile
                && !hasResolvedImportMethodModelingEvidence(repoRoot, binding.resolvedFile, declaredOwner, method)) {
                continue;
            }
            const statementEnd = findStatementEnd(text, closeParen);
            out.push({
                receiver,
                declaredOwner,
                method,
                invokeKind: "instance",
                start: match.index || 0,
                statementText: text.slice(match.index || 0, statementEnd),
                argCount: args.length,
                importSource,
                resolvedFile: binding.resolvedFile,
            });
        }
    }
    for (const [declaredOwner, binding] of boundaryOwners.entries()) {
        const importSource = binding.source;
        const ownerPattern = new RegExp(`\\b${escapeRegExp(declaredOwner)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, "g");
        for (const match of text.matchAll(ownerPattern)) {
            const method = match[1];
            if (!method || shouldIgnoreDirectBoundaryMethod(method)) {
                continue;
            }
            const openParen = text.indexOf("(", (match.index || 0) + match[0].lastIndexOf(method));
            if (openParen < 0) {
                continue;
            }
            const closeParen = findMatchingParen(text, openParen);
            if (closeParen < 0) {
                continue;
            }
            const argsText = text.slice(openParen + 1, closeParen);
            const args = splitTopLevelArguments(argsText);
            if (!hasModelableDirectCallShape(method, argsText, args.length)) {
                continue;
            }
            if (binding.resolvedFile
                && !hasResolvedImportMethodModelingEvidence(repoRoot, binding.resolvedFile, declaredOwner, method)) {
                continue;
            }
            const statementEnd = findStatementEnd(text, closeParen);
            out.push({
                receiver: declaredOwner,
                declaredOwner,
                method,
                invokeKind: "any",
                start: match.index || 0,
                statementText: text.slice(match.index || 0, statementEnd),
                argCount: args.length,
                importSource,
                resolvedFile: binding.resolvedFile,
            });
        }
    }
    return out;
}

function collectBoundaryImportedOwnerSources(imports: Map<string, ImportBinding>): Map<string, ImportBinding> {
    const out = new Map<string, ImportBinding>();
    for (const [name, binding] of imports.entries()) {
        const source = String(binding.source || "").trim();
        if (!source) {
            continue;
        }
        if (!source.startsWith(".")) {
            out.set(name, binding);
            continue;
        }
        if (binding.resolvedFile) {
            out.set(name, binding);
        }
    }
    return out;
}

function isProjectPageOrComponentFile(relFile: string): boolean {
    return /\/(pages?|components?|views?)\//.test(normalizeSlashes(relFile).toLowerCase());
}

function shouldIgnoreDirectBoundaryMethod(method: string): boolean {
    return /^(constructor|build|render|tostring|valueof|foreach|map|filter|reduce|indexof|includes|trim|touppercase|tolowercase)$/i.test(method);
}

function hasModelableDirectCallShape(
    method: string,
    argsText: string,
    argCount: number,
): boolean {
    if (argCount > 0) {
        return true;
    }
    return /^(on|once|subscribe|register|listen|connect|disconnect|open|close|start|stop)$/i.test(method)
        || DATA_ENDPOINT_TOKEN_RE.test(argsText);
}

function hasResolvedImportMethodModelingEvidence(
    repoRoot: string,
    resolvedFile: string,
    owner: string,
    method: string,
): boolean {
    const evidence = resolveImportedReceiverMethodEvidence(repoRoot, resolvedFile, owner, method);
    if (!evidence) {
        return false;
    }
    if (!hasExecutableMethodBody(evidence)) {
        return false;
    }
    if (isTransparentParameterOnlyMethod(evidence)) {
        return false;
    }
    return hasWrapperMethodStructuralEffect(evidence)
        || shouldCreateReturnedValueSurfaceCandidate(evidence)
        || hasBridgeModelingSignal(evidence.code)
        || hasProjectEventBusWrapperSignal(
            normalizeSlashes(resolvedFile).toLowerCase(),
            method.toLowerCase(),
            evidence.code.toLowerCase(),
            evidence,
        );
}

function isTransparentParameterOnlyMethod(candidate: MethodCandidate): boolean {
    if (candidate.paramNames.length === 0) {
        return false;
    }
    const code = candidate.code
        .replace(/^\s*\d+\s*\|\s*/gm, "")
        .replace(/\/\/.*$/gm, "")
        .trim();
    const returnExprs = [...code.matchAll(/\breturn\s+([^;\n]+)/gi)]
        .map(match => match[1].replace(/\s+/g, " ").trim())
        .filter(Boolean);
    if (returnExprs.length === 0) {
        return false;
    }
    return returnExprs.every(expr => {
        const normalized = expr.replace(/\s+/g, "");
        return candidate.paramNames.some(param => {
            const escaped = escapeRegExp(param);
            return new RegExp(`^${escaped}$`).test(normalized)
                || new RegExp(`^${escaped}\\.(?:trim|tostring|tolowercase|touppercase)\\(\\)$`, "i").test(normalized)
                || new RegExp(`^String\\(${escaped}\\)$`).test(normalized);
        });
    });
}

function hasExecutableMethodBody(candidate: MethodCandidate): boolean {
    const code = candidate.code
        .replace(/^\s*\d+\s*\|\s*/gm, "")
        .replace(/\/\/.*$/gm, "")
        .trim();
    const body = code.match(/\{([\s\S]*)\}/)?.[1] || "";
    return body.replace(/\s+/g, "").replace(/;+/g, "").length > 0;
}

function buildDirectBoundaryCallsiteReasons(relFile: string, call: DirectBoundaryCallsite): string[] {
    const combined = `${relFile}\n${call.method}\n${call.statementText}\n${call.importSource}\n${call.declaredOwner}`.toLowerCase();
    const normalized = combined.replace(/[_-]+/g, " ");
    const reasons = ["direct-project-or-third-party-callsite"];
    if (DATA_ENDPOINT_TOKEN_RE.test(normalized)) {
        reasons.push("payload-argument-evidence");
    }
    if (/\/(pages?|components?|views?)\//.test(normalizeSlashes(relFile).toLowerCase())) {
        reasons.push("ui-callsite-boundary");
    }
    if (call.argCount > 0) {
        reasons.push("has-arguments");
    }
    return reasons;
}

function buildDirectBoundaryCallsiteSignature(relFile: string, call: DirectBoundaryCallsite): string {
    const params = Array.from({ length: Math.max(0, call.argCount) }, () => "Unknown").join(", ");
    const modulePath = call.resolvedFile
        ? normalizeSlashes(call.resolvedFile)
        : normalizeSlashes(call.importSource || relFile);
    return `@${modulePath}: ${call.declaredOwner}.${call.method}(${params})`;
}

function collectTypedReceivers(text: string): Map<string, string> {
    const receivers = new Map<string, string>();
    const lines = String(text || "").split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.split("//")[0] || "";
        collectTypedReceiverFromLine(line, receivers);
    }
    return receivers;
}

function collectTypedReceiverFromLine(line: string, receivers: Map<string, string>): void {
    const declarationLine = line.replace(/^\s*(?:@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*)+/, "");
    const propertyMatch = declarationLine.match(/^\s*(?:(?:private|public|protected|readonly|static)\s+)*([A-Za-z_$][\w$]*)\??\s*:\s*([A-Za-z_$][\w$]*)\s*(?:=|;)/);
    if (propertyMatch) {
        receivers.set(propertyMatch[1], propertyMatch[2]);
    }
    const localMatch = declarationLine.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*(?:=|;)/);
    if (localMatch) {
        receivers.set(localMatch[1], localMatch[2]);
    }
}

function shouldIgnoreDeclaredOwnerMethod(method: string): boolean {
    return /^(build|constructor|toString|valueOf)$/.test(method);
}

function declaredOwnerHintKey(hint: DeclaredOwnerCallsiteHint): string {
    return [
        hint.method,
        hint.declaredOwner,
        hint.receiver,
        hint.callerFile,
        hint.invokeLine,
    ].join("\u0000");
}

function buildDeclaredOwnerSurfaceCandidates(
    baseItem: NormalizedCallsiteItem,
    method: MethodCandidate,
    hints: DeclaredOwnerCallsiteHint[],
): NormalizedCallsiteItem[] {
    if (!method.owner || !method.baseOwner || method.isStatic) {
        return [];
    }
    const compatibleHints = hints
        .filter(hint => hint.declaredOwner !== method.owner)
        .filter(hint => isDeclaredOwnerCompatible(method, hint.declaredOwner));
    const byOwner = new Map<string, DeclaredOwnerCallsiteHint[]>();
    for (const hint of compatibleHints) {
        const group = byOwner.get(hint.declaredOwner) || [];
        if (group.length < 3) {
            group.push(hint);
        }
        byOwner.set(hint.declaredOwner, group);
    }
    const out: NormalizedCallsiteItem[] = [];
    for (const [declaredOwner, ownerHints] of byOwner.entries()) {
        out.push({
            ...baseItem,
            callee_signature: buildProjectApiWrapperSignature(String(baseItem.sourceFile || ""), method, declaredOwner),
            count: Math.max(Number(baseItem.count || 1), ownerHints.length),
            topEntries: [
                ...((baseItem.topEntries || []) as string[]),
                "origin=recall_api_surface_declared_owner",
                `declaredOwnerFromCallsite=${declaredOwner}`,
                `implementationOwner=${method.owner}`,
                `implementationBaseOwner=${method.baseOwner}`,
                ...ownerHints.map(hint => `declaredOwnerCallsite=${hint.callerFile}:${hint.invokeLine}:${hint.receiver}`),
            ],
            candidateOrigin: "recall_api_surface_declared_owner",
            methodSnippetSource: `recall_api_surface implementationOwner=${method.owner} declaredOwner=${declaredOwner}`,
            contextSlices: ownerHints.map(hint => ({
                callerFile: hint.callerFile,
                callerMethod: "-",
                invokeLine: hint.invokeLine,
                invokeStmtText: hint.invokeStmtText,
                windowLines: hint.windowLines,
                cfgNeighborStmts: [],
            })),
        } as NormalizedCallsiteItem);
    }
    return out;
}

function isDeclaredOwnerCompatible(method: MethodCandidate, declaredOwner: string): boolean {
    return !!method.baseOwner && method.baseOwner === declaredOwner;
}

function selectApiSurfaceCandidateAccumulators(
    candidates: CandidateAccumulator[],
    maxCandidates: number,
): CandidateAccumulator[] {
    const sorted = [...candidates]
        .sort(compareApiModelingCandidateAccumulators);
    const byKey = new Map<string, CandidateAccumulator[]>();
    for (const candidate of sorted) {
        const key = apiSurfacePairKey(candidate.item);
        const group = byKey.get(key) || [];
        group.push(candidate);
        byKey.set(key, group);
    }
    const selected: CandidateAccumulator[] = [];
    const selectedKeys = new Set<string>();
    const add = (candidate: CandidateAccumulator): boolean => {
        if (selected.length >= maxCandidates) {
            return false;
        }
        const key = apiSurfaceCandidateKey(candidate.item);
        if (selectedKeys.has(key)) {
            return false;
        }
        selected.push(candidate);
        selectedKeys.add(key);
        return true;
    };
    for (const candidate of sorted) {
        if (selected.length >= maxCandidates) {
            break;
        }
        if (!add(candidate)) {
            continue;
        }
        const sibling = findApiSurfaceFocusSibling(candidate, byKey.get(apiSurfacePairKey(candidate.item)) || []);
        if (sibling) {
            add(sibling);
        }
    }
    return selected;
}

function compareApiModelingCandidateAccumulators(left: CandidateAccumulator, right: CandidateAccumulator): number {
    return apiModelingTierIndex(left.tier) - apiModelingTierIndex(right.tier)
        || apiModelingDeclaredOwnerOrder(left.item) - apiModelingDeclaredOwnerOrder(right.item)
        || apiModelingReturnedValueOrder(left.item) - apiModelingReturnedValueOrder(right.item)
        || String(left.item.callee_signature).localeCompare(String(right.item.callee_signature))
        || left.originalIndex - right.originalIndex;
}

function apiModelingDeclaredOwnerOrder(item: NormalizedCallsiteItem): number {
    const topEntries = Array.isArray((item as any).topEntries) ? (item as any).topEntries : [];
    return topEntries.some((entry: unknown) => String(entry || "").includes("declaredOwnerFromCallsite=")) ? 0 : 1;
}

function apiModelingReturnedValueOrder(item: NormalizedCallsiteItem): number {
    return isReturnedValueCandidate(item) ? 0 : 1;
}

function findApiSurfaceFocusSibling(
    candidate: CandidateAccumulator,
    group: CandidateAccumulator[],
): CandidateAccumulator | undefined {
    const hasFocus = isReturnedValueCandidate(candidate.item);
    return group.find(item => isReturnedValueCandidate(item.item) !== hasFocus);
}

function isReturnedValueCandidate(item: NormalizedCallsiteItem): boolean {
    return String((item as any).semanticFocus || "").trim() === "returned_value_surface"
        || String((item as any).candidateOrigin || "").trim() === "recall_returned_value_surface";
}

function apiSurfacePairKey(item: NormalizedCallsiteItem): string {
    return [
        normalizeSlashes(String(item.sourceFile || "")),
        String((item as any).callee_signature || ""),
        String(item.method || ""),
        String((item as any).invokeKind || ""),
        String((item as any).argCount ?? ""),
    ].join("\u0000");
}

function apiSurfaceCandidateKey(item: NormalizedCallsiteItem): string {
    return [
        apiSurfacePairKey(item),
        String((item as any).candidateOrigin || ""),
        String((item as any).semanticFocus || ""),
    ].join("\u0000");
}

function collectSourceFiles(repoRoot: string, sourceDirs: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const sourceDir of sourceDirs.length > 0 ? sourceDirs : ["."]) {
        const abs = path.resolve(repoRoot, sourceDir);
        if (!fs.existsSync(abs)) continue;
        walkSourceFiles(abs, out, seen);
    }
    return out;
}

function isLikelyProjectApiWrapperFile(relFile: string, text: string): boolean {
    const normalized = normalizeSlashes(relFile).toLowerCase();
    if (/\/(pages?|components?|views?)\//.test(normalized)) {
        return hasPageLocalProjectApiWrapperSignal(text);
    }
    if (/(^|\/)(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|viewmodel|viewmodels|configure|database|db|cache|cacher|logger|log|tracks)(\/|$)/.test(normalized)) {
        return true;
    }
    if (hasBridgeModelingSignal(text)
        && hasBridgePathSignal(normalized)) {
        return true;
    }
    if (hasProjectEventBusWrapperFileSignal(normalized, text)) {
        return true;
    }
    if (/(^|\/)(model|models|entity|entities|dto|dtos)(\/|$)/.test(normalized)
        && /\b(?:static\s+)?(?:from|patch|change|copy|clone)\s*\([^)]*\)\s*\{[\s\S]{0,1600}\b(?:return|=)\b/.test(text)) {
        return true;
    }
    return hasExportedSurfaceDeclaration(text)
        && hasStructuralWrapperEvidence(text);
}

function hasProjectEventBusWrapperFileSignal(pathLower: string, text: string): boolean {
    const lowered = String(text || "").toLowerCase();
    const eventPath = /(^|\/)(event|events|eventbus|emitter|bus|channel|message|messages|common|utils?)(\/|$)/.test(pathLower);
    const exportedApi = /\b(export\s+(class|const|function)|class\s+[A-Z]|function\s+[A-Za-z_$])/.test(text);
    const eventOperation = /\.\s*(?:emit|on|once|off|subscribe|unsubscribe|publish|trigger|dispatch|fire)\s*\(/.test(lowered);
    const eventKey = /\b(eventid|eventname|channel|topic|callback|payload|data)\b/.test(lowered);
    return exportedApi && eventOperation && (eventPath || eventKey);
}

function hasPageLocalProjectApiWrapperSignal(text: string): boolean {
    if (!/\bimport\b[\s\S]{0,240}\bfrom\s*["'][^"']+["']/.test(String(text || ""))) {
        return false;
    }
    return hasStructuralWrapperEvidence(text);
}

function hasExportedSurfaceDeclaration(text: string): boolean {
    return /\b(export\s+(class|struct|const|function)|class\s+[A-Z]|struct\s+[A-Z]|function\s+[A-Za-z_$])/.test(text);
}

function hasStructuralWrapperEvidence(text: string): boolean {
    const body = String(text || "");
    return STRUCTURAL_EFFECT_METHOD_RE.test(body)
        || /\bObject\s*\.\s*(?:assign|keys|values|entries)\s*\(/.test(body)
        || /\b(?:new\s+Map|new\s+Set|\.set\s*\(|\.get\s*\(|\.push\s*\(|\.pop\s*\(|\.splice\s*\()/.test(body)
        || /\bthis\s*\.\s*[A-Za-z_$][\w$]*/.test(body)
        || DATA_ENDPOINT_TOKEN_RE.test(body);
}

function collectProjectApiWrapperMethods(text: string): MethodCandidate[] {
    const out: MethodCandidate[] = [];
    const lines = text.split(/\r?\n/);
    collectClassMethodCandidates(lines, out);
    collectTopLevelFunctionCandidates(lines, out);
    return out;
}

function collectClassMethodCandidates(lines: string[], out: MethodCandidate[]): void {
    const classPattern = /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|struct)\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*))?\b/;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(classPattern);
        if (!m) continue;
        const owner = m[1];
        const baseOwner = m[2];
        const end = findBlockEnd(lines, i);
        if (end < i) continue;
        let depth = 0;
        for (let j = i; j <= end; j++) {
            const line = lines[j];
            if (j > i && depth === 1) {
                const headerText = collectClassMethodHeader(lines, j, end);
                const method = parseClassMethodHeader(headerText);
                if (method) {
                    const methodEnd = findBlockEnd(lines, j);
                    const snippet = collectSnippet(lines, j, methodEnd >= j ? methodEnd : end);
                    const paramNames = parseTopLevelParameterNames(method.params);
                    out.push({
                        owner,
                        baseOwner,
                        method: method.name,
                        isStatic: method.isStatic,
                        argCount: paramNames.length,
                        paramNames,
                        returnType: method.returnType,
                        startLine: j + 1,
                        code: snippet,
                    });
                }
            }
            depth += countCharOutsideStrings(line, "{") - countCharOutsideStrings(line, "}");
        }
        i = end;
    }
}

function collectClassMethodHeader(lines: string[], startIndex: number, classEndIndex: number): string {
    const firstLine = lines[startIndex] || "";
    if (firstLine.includes(")")) {
        return firstLine;
    }
    const collected = [firstLine];
    let parenDepth = countCharOutsideStrings(firstLine, "(") - countCharOutsideStrings(firstLine, ")");
    const limit = Math.min(classEndIndex, startIndex + 12);
    for (let i = startIndex + 1; i <= limit && parenDepth > 0; i++) {
        const line = lines[i] || "";
        collected.push(line);
        parenDepth += countCharOutsideStrings(line, "(") - countCharOutsideStrings(line, ")");
        if (parenDepth <= 0) {
            break;
        }
    }
    return collected.join("\n");
}

function collectTopLevelFunctionCandidates(lines: string[], out: MethodCandidate[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fn = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>{}()]*>\s*)?\(([^)]*)\)/);
        const prop = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:<[^>{}()]*>\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/);
        const m = fn || prop;
        if (!m) continue;
        const snippet = collectSnippet(lines, i, Math.min(lines.length - 1, i + 80));
        const paramNames = parseTopLevelParameterNames(m[2]);
        out.push({
            method: m[1],
            isStatic: true,
            argCount: paramNames.length,
            paramNames,
            returnType: extractReturnTypeFromHeader(line),
            startLine: i + 1,
            code: snippet,
        });
    }
}

function countTopLevelParameters(params: string): number {
    return parseTopLevelParameterNames(params).length;
}

function parseTopLevelParameterNames(params: string): string[] {
    const text = String(params || "").trim();
    if (!text) {
        return [];
    }
    let depth = 0;
    const parts: string[] = [];
    let current = "";
    for (const ch of text) {
        if (ch === "<" || ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if ((ch === ">" || ch === ")" || ch === "]" || ch === "}") && depth > 0) {
            depth--;
        } else if (ch === "," && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts
        .map(part => part
            .replace(/^\s*(?:public|private|protected|readonly)\s+/, "")
            .replace(/\s*=.*$/s, "")
            .replace(/\s*:.*$/s, "")
            .replace(/^\s*\.\.\./, "")
            .replace(/\?$/, "")
            .trim())
        .filter(part => /^[A-Za-z_$][\w$]*$/.test(part));
}

function parseClassMethodHeader(line: string): { name: string; params: string; returnType?: string; isStatic: boolean } | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return undefined;
    if (/^(if|for|while|switch|catch|return|else|new)\b/.test(trimmed)) return undefined;
    const m = trimmed.match(/^(?:(?:public|private|protected|override|readonly)\s+)*(static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>{}()]*>\s*)?\(([^)]*)\)/)
        || trimmed.match(/^(?:(?:public|private|protected|override|readonly)\s+)*(static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:<[^>{}()]*>\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/);
    if (!m) return undefined;
    const name = m[2];
    if (name === "constructor" || /^[A-Z]/.test(name)) return undefined;
    return {
        name,
        params: m[3],
        returnType: extractReturnTypeFromHeader(line),
        isStatic: !!m[1],
    };
}

function extractReturnTypeFromHeader(line: string): string | undefined {
    const text = String(line || "");
    const parenIndex = text.lastIndexOf(")");
    if (parenIndex < 0) return undefined;
    const rest = text.slice(parenIndex + 1);
    const match = rest.match(/^\s*:\s*([^={;]+?)(?:\s*(?:=>|\{)|\s*$)/);
    const returnType = match?.[1]?.trim();
    return returnType || undefined;
}

function findBlockEnd(lines: string[], startIndex: number): number {
    let depth = 0;
    let sawOpeningBrace = false;
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        const opens = countCharOutsideStrings(line, "{");
        const closes = countCharOutsideStrings(line, "}");
        if (opens > 0) sawOpeningBrace = true;
        depth += opens - closes;
        if (sawOpeningBrace && depth <= 0) return i;
    }
    return -1;
}

function collectSnippet(lines: string[], startIndex: number, maxEndIndex: number): string {
    const out: string[] = [];
    let depth = 0;
    let sawOpeningBrace = false;
    const endLimit = Math.min(lines.length - 1, startIndex + 70, maxEndIndex);
    for (let i = startIndex; i <= endLimit; i++) {
        const line = lines[i];
        out.push(`${String(i + 1).padStart(5, " ")} | ${line}`);
        const opens = countCharOutsideStrings(line, "{");
        const closes = countCharOutsideStrings(line, "}");
        if (opens > 0) sawOpeningBrace = true;
        depth += opens - closes;
        if (!sawOpeningBrace && /;\s*$/.test(line)) break;
        if (sawOpeningBrace && i > startIndex && depth <= 0) break;
    }
    return out.join("\n");
}

function countCharOutsideStrings(line: string, target: "{" | "}" | "(" | ")"): number {
    let count = 0;
    let quote: string | undefined;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === target) count++;
    }
    return count;
}

function classifyProjectApiWrapperMethod(relFile: string, candidate: MethodCandidate): ProjectApiWrapperClassification {
    const pathLower = normalizeSlashes(relFile).toLowerCase();
    const methodLower = candidate.method.toLowerCase();
    const bodyLower = candidate.code.toLowerCase();
    if (!hasExecutableMethodBody(candidate)) {
        return { eligible: false, tier: "project-wrapper", reasons: ["empty-or-declaration-only-method"] };
    }
    const hasBridgeSignal = hasBridgeModelingSignal(candidate.code)
        || (hasBridgePathSignal(pathLower) && hasBridgeReceiverMethodSignal(methodLower, bodyLower));
    const loggingPayload = isLoggingPayloadSurface(pathLower, methodLower, candidate);
    const loggingConfig = isLoggingConfigSurface(methodLower, bodyLower);
    const delegatedReturnedValue = hasDelegatedReturnedValueProducer(candidate);
    const eventBusWrapper = hasProjectEventBusWrapperSignal(pathLower, methodLower, bodyLower, candidate);
    const reasons: string[] = [];
    if (isOfficialArkMainEntryCandidate(pathLower, candidate.method, candidate.owner)) {
        reasons.push("official-entry-shape");
    }
    if (isFrameworkContextHelperCandidate(pathLower, methodLower, bodyLower, candidate.owner)) {
        return { eligible: false, tier: "project-wrapper", reasons: ["framework-context-helper"] };
    }
    const isModelMapper = isProjectModelMapperMethod(pathLower, methodLower, bodyLower, candidate);
    if (/(^|\/)(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|configure)(\/|$)/.test(pathLower)) reasons.push("wrapper-container-path");
    if (/(^|\/)(viewmodel|viewmodels)(\/|$)/.test(pathLower)) reasons.push("viewmodel-wrapper-path");
    if (/(^|\/)(database|db|cache|cacher|logger|log|tracks)(\/|$)/.test(pathLower)) reasons.push("state-or-logging-container-path");
    if (isModelMapper) reasons.push("model-serialization-wrapper");
    if (DATA_ENDPOINT_TOKEN_RE.test(methodLower) || DATA_ENDPOINT_TOKEN_RE.test(bodyLower)) reasons.push("data-endpoint-name");
    const hasStructuralEffectSignal = hasWrapperMethodStructuralEffect(candidate)
        || hasBridgeSignal
        || loggingPayload
        || hasReceiverFieldCarrierSignal(candidate.code);
    if (hasBridgeSignal) reasons.push("webview-or-js-bridge-wrapper");
    if (hasCallForwardingSignal(candidate)) reasons.push("call-forwarding-effect");
    if (delegatedReturnedValue) reasons.push("delegated-returned-value");
    if (loggingPayload) reasons.push("logging-payload-wrapper");
    if (loggingPayload && candidate.owner && /^logger$/i.test(candidate.owner) && candidate.isStatic) reasons.push("static-logger-payload-wrapper");
    if (loggingConfig) reasons.push("logging-configuration-helper");
    if (hasReceiverFieldCarrierSignal(candidate.code)) reasons.push("receiver-field-carrier");
    if (DATA_ENDPOINT_TOKEN_RE.test(bodyLower) && STRUCTURAL_EFFECT_METHOD_RE.test(candidate.code)) reasons.push("payload-forwarding-boundary");
    if (/\b(access_token|refresh_token|authorizationcode|credential|password|phone|email|openid|unionid|token|cookie|apikey|session)\b/.test(bodyLower)) reasons.push("sensitive-payload-name");
    if (eventBusWrapper) reasons.push("project-event-bus-effect");
    if (/^(check|is|has|validate|format|parseurl|back|scroll|build|render)/.test(methodLower)) reasons.push("guard-or-ui-helper-name");
    if (/(\/context\.ets|\/stage\.ets|\/device\.ets)/.test(pathLower) || /(context|stage|window|avoidarea|safearea|windowsize)/.test(methodLower)) {
        return { eligible: false, tier: "project-wrapper", reasons: ["context-or-window-setup-helper"] };
    }
    if (loggingConfig && !loggingPayload) {
        return { eligible: false, tier: "project-wrapper", reasons };
    }
    if (reasons.includes("guard-or-ui-helper-name")
        && !DATA_ENDPOINT_TOKEN_RE.test(bodyLower)
        && !hasCallForwardingSignal(candidate)
        && !delegatedReturnedValue
        && !hasBridgeSignal) {
        return { eligible: false, tier: "project-wrapper", reasons };
    }
    const eligible = hasStructuralEffectSignal
        || eventBusWrapper
        || isModelMapper
        || !!delegatedReturnedValue
        || reasons.includes("wrapper-container-path")
        || reasons.includes("state-or-logging-container-path")
        || reasons.includes("sensitive-payload-name");
    if (!eligible) {
        return { eligible: false, tier: "project-wrapper", reasons: [...reasons, "insufficient-structural-evidence"] };
    }
    const tier: ApiModelingCandidateTier = delegatedReturnedValue && !hasBridgeSignal && candidate.returnType && candidate.returnType !== "void"
        ? "returned-value-wrapper"
        : "project-wrapper";
    return { eligible: true, tier, reasons };
}

function isLoggingPayloadSurface(pathLower: string, methodLower: string, candidate: MethodCandidate): boolean {
    if (!/(^|\/)(logger|log)(\/|$)/.test(pathLower)) {
        return false;
    }
    if (candidate.argCount <= 0) {
        return false;
    }
    return /^(log|reallog|logbycustomconfig|debug|info|warn|error|fatal|trace|verbose|json|json2|json3|d|i|w|e|f|dt|it|wt|et|ft)$/.test(methodLower);
}

function isLoggingConfigSurface(methodLower: string, bodyLower: string): boolean {
    if (/^(init|initialize|getlogger|addlogadapter|removelogadapter|clearlogadapter|setconfig|mergeconfig|config|isloggable)$/.test(methodLower)) {
        return true;
    }
    return /\b(addlogadapter|removelogadapter|clearlogadapter|printerproxys\.get|printerproxys\.set)\b/.test(bodyLower)
        && !/\b(hilog|console)\s*\./.test(bodyLower);
}

function hasWrapperMethodStructuralEffect(candidate: MethodCandidate): boolean {
    return hasCallForwardingSignal(candidate)
        || hasReceiverFieldCarrierSignal(candidate.code)
        || hasReturnedCallExpression(candidate.code)
        || /\.\s*(?:then|catch|finally)\s*\(/.test(candidate.code)
        || /\bObject\s*\.\s*(?:assign|keys|values|entries)\s*\(/.test(candidate.code)
        || /\b(?:new\s+Map|new\s+Set|\.set\s*\(|\.get\s*\(|\.push\s*\(|\.splice\s*\()/.test(candidate.code);
}

function hasCallForwardingSignal(candidate: MethodCandidate): boolean {
    if (candidate.paramNames.length === 0) {
        return STRUCTURAL_EFFECT_METHOD_RE.test(candidate.code)
            && DATA_ENDPOINT_TOKEN_RE.test(candidate.code);
    }
    return candidate.paramNames.some(param => {
        const escaped = escapeRegExp(param);
        return new RegExp(`\\.\\s*[A-Za-z_$][\\w$]*\\s*\\([^)]*\\b${escaped}\\b`, "s").test(candidate.code)
            || new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\([^)]*\\b${escaped}\\b`, "s").test(candidate.code)
            || new RegExp(`\\b${escaped}\\b\\s*[:=]`).test(candidate.code)
            || new RegExp(`\\b${escaped}\\b\\s*[,)]`).test(candidate.code);
    });
}

function hasReceiverFieldCarrierSignal(code: string): boolean {
    const text = String(code || "");
    return /\bthis\s*\.\s*[A-Za-z_$][\w$]*/.test(text)
        && (STRUCTURAL_EFFECT_METHOD_RE.test(text)
            || /\bObject\s*\.\s*assign\s*\(/.test(text)
            || /\.\s*(?:set|get|push|splice)\s*\(/.test(text));
}

function hasReturnedCallExpression(code: string): boolean {
    return /\breturn\s+(?:await\s+)?(?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/.test(String(code || ""))
        || /\breturn\s+(?:await\s+)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+\s*\(/.test(String(code || ""));
}

function candidateBoundaryHints(relFile: string, candidate: MethodCandidate): string[] {
    const pathLower = normalizeSlashes(relFile).toLowerCase();
    const methodLower = candidate.method.toLowerCase();
    const bodyLower = candidate.code.toLowerCase();
    const hints: string[] = [];
    if (isOfficialArkMainEntryCandidate(pathLower, candidate.method, candidate.owner)) {
        hints.push("candidateBoundary=official_arkmain_entry_evidence");
    }
    if (isFrameworkContextHelperCandidate(pathLower, methodLower, bodyLower, candidate.owner)) {
        hints.push("candidateBoundary=framework_context_helper_evidence");
    }
    if (hasOutboundProjectWrapperBoundaryHint(pathLower, methodLower, bodyLower)) {
        hints.push("candidateBoundary=project_or_third_party_wrapper_evidence");
    }
    if (/(^|\/)(database|db|cache|cacher)(\/|$)/.test(pathLower)) {
        hints.push("candidateBoundary=project_state_or_database_wrapper_evidence");
    }
    if (/(^|\/)(logger|log)(\/|$)/.test(pathLower)) {
        hints.push("candidateBoundary=project_logging_wrapper_evidence");
    }
    if (/\/(pages?|components?|views?)\//.test(pathLower) && hasWrapperMethodStructuralEffect(candidate)) {
        hints.push("candidateBoundary=page_local_project_or_third_party_wrapper_evidence");
    }
    if (hasBridgeModelingSignal(candidate.code) || hasBridgePathSignal(pathLower)) {
        hints.push("candidateBoundary=project_or_third_party_bridge_evidence");
    }
    if (hasProjectEventBusWrapperSignal(pathLower, methodLower, bodyLower, candidate)) {
        hints.push("candidateBoundary=project_event_bus_wrapper_evidence");
    }
    return hints;
}

function hasProjectEventBusWrapperSignal(
    pathLower: string,
    methodLower: string,
    bodyLower: string,
    candidate: MethodCandidate,
): boolean {
    const owner = String(candidate.owner || "").toLowerCase();
    const eventContainer =
        /(^|\/)(event|events|eventbus|emitter|bus|channel|message|messages|common|utils?)(\/|$)/.test(pathLower)
        || hasAnyReceiverToken(owner, ["event", "emitter", "hub", "bus", "channel", "message"]);
    if (!eventContainer) {
        return false;
    }
    const methodShape = /^(send|sendevent|emit|publish|trigger|dispatch|post|fire|notify|on|once|subscribe|off|unsubscribe|remove)$/.test(methodLower)
        || hasAnyReceiverToken(methodLower, ["event", "emit", "publish", "dispatch", "notify"]);
    if (!methodShape) {
        return false;
    }
    return /\b(?:eventid|eventname|channel|topic|payload|data|callback)\b/.test(bodyLower)
        || /\.\s*(?:emit|on|once|off|subscribe|unsubscribe|publish|trigger|dispatch|fire)\s*\(/.test(bodyLower);
}

function hasOutboundProjectWrapperBoundaryHint(
    pathLower: string,
    methodLower: string,
    bodyLower: string,
): boolean {
    if (!/(^|\/)(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|viewmodel|viewmodels)(\/|$)/.test(pathLower)) {
        return false;
    }
    if (STRUCTURAL_EFFECT_METHOD_RE.test(bodyLower) && (DATA_ENDPOINT_TOKEN_RE.test(bodyLower) || /\breturn\b/.test(bodyLower))) {
        return true;
    }
    return DATA_ENDPOINT_TOKEN_RE.test(methodLower);
}

function hasBridgePathSignal(pathLower: string): boolean {
    return /(^|\/)(bridge|bridges|jsbridge|webview|hybridcontainer)(\/|$)/.test(pathLower);
}

function hasBridgeModelingSignal(text: string): boolean {
    return /\b(runJavaScript|registerJavaScriptProxy|javaScriptProxy|JavaScriptInterface|callHandler|callJs|Reflect\.get|WebViewController|WebviewController|webview|ChannelProxy|messageHandler|RenderToService|callbackToJs)\b/i.test(String(text || ""))
        || /\bDMPMap\s*\.\s*createFromObject\s*\([^)]*\b(?:msg|body|payload|params)\b/i.test(String(text || ""));
}

function hasBridgeReceiverMethodSignal(methodLower: string, bodyLower: string): boolean {
    if (/^(invoke|publish|call|callhandler|registerjavascriptproxy|runjavascript|callbacktojs|returnvalue|messagehandler|rendertoservice)$/.test(methodLower)) {
        return true;
    }
    return /\b(channelproxy|messagehandler|rendertoservice|callbacktojs|runjavascript|registerjavascriptproxy)\b/i.test(bodyLower)
        || /\bDMPMap\s*\.\s*createFromObject\s*\([^)]*\b(?:msg|body|payload|params)\b/i.test(bodyLower);
}

function isOfficialArkMainEntryCandidate(pathLower: string, methodName: string, owner?: string): boolean {
    return isFrameworkLifecycleCandidate(pathLower, methodName, owner)
        || isFrameworkCallbackCandidate(pathLower, methodName, owner);
}

function isFrameworkLifecycleCandidate(pathLower: string, methodName: string, owner?: string): boolean {
    if (!isFrameworkEntryOwnerOrPath(pathLower, owner)) {
        return false;
    }
    const ownerKind = classifyFrameworkEntryOwner(pathLower, owner);
    if (ownerKind === "stage") {
        return !!resolveStageLifecycleContract(methodName);
    }
    if (ownerKind === "extension") {
        return !!resolveExtensionLifecycleContract(methodName);
    }
    if (ownerKind === "ability") {
        return !!resolveAbilityLifecycleContract(methodName);
    }
    return !!resolveAbilityLifecycleContract(methodName)
        || !!resolveStageLifecycleContract(methodName)
        || !!resolveExtensionLifecycleContract(methodName);
}

function isFrameworkCallbackCandidate(pathLower: string, methodName: string, owner?: string): boolean {
    if (!isFrameworkEntryOwnerOrPath(pathLower, owner)) {
        return false;
    }
    return ARK_MAIN_FRAMEWORK_CALLBACK_METHOD_NAMES.has(methodName);
}

function isFrameworkContextHelperCandidate(pathLower: string, methodLower: string, bodyLower: string, owner?: string): boolean {
    if (!isFrameworkEntryOwnerOrPath(pathLower, owner)) {
        return false;
    }
    const contextHelperName = /(context|stage|window|avoidarea|safearea|windowsize|systembar|orientation|mainwindow)/.test(methodLower);
    const windowContextUse = /\b(windowstage|getmainwindow|getmainwindowsync|getwindowavoidarea|getwindowproperties|setsystembar|setwindowlayoutfullscreen|windowavoidarea|safearea)\b/.test(bodyLower);
    return contextHelperName && windowContextUse;
}

function isFrameworkEntryOwnerOrPath(pathLower: string, owner?: string): boolean {
    const ownerLower = String(owner || "").toLowerCase();
    return /(^|\/)(entryability|ability|abilities|extension|extensions|formability|formextension|serviceextension|serviceext|stub|idl|rpc|remote)(\/|$)/.test(pathLower)
        || /(ability|extension|formability|formextension|stub|remote|serviceext)$/.test(ownerLower)
        || /(entryability|formability|formextension|serviceextension|serviceext|stub|idl)/.test(ownerLower);
}

function classifyFrameworkEntryOwner(pathLower: string, owner?: string): "ability" | "stage" | "extension" | "unknown" {
    const ownerLower = String(owner || "").toLowerCase();
    if (/(^|\/)(abilitystage|stage)(\/|$)/.test(pathLower) || /(abilitystage|stage)$/.test(ownerLower)) {
        return "stage";
    }
    if (/(^|\/)(extension|extensions|formability|formextension|serviceextension|serviceext)(\/|$)/.test(pathLower)
        || /(extension|formability|formextension|serviceext)$/.test(ownerLower)
        || /(formextension|serviceextension|serviceext)/.test(ownerLower)) {
        return "extension";
    }
    if (/(^|\/)(entryability|ability|abilities)(\/|$)/.test(pathLower)
        || /(entryability|ability)$/.test(ownerLower)) {
        return "ability";
    }
    return "unknown";
}

function isProjectModelMapperMethod(
    pathLower: string,
    methodLower: string,
    bodyLower: string,
    candidate: MethodCandidate,
): boolean {
    if (!/(^|\/)(model|models|entity|entities|dto|dtos)(\/|$)/.test(pathLower)) {
        return false;
    }
    if (candidate.argCount <= 0) {
        return false;
    }
    if (!/^(from|patch|change|copy|clone|assign|merge)$/.test(methodLower)) {
        return false;
    }
    return /\b(?:json|dto|data|partial|payload|input|source)\b/.test(bodyLower)
        && /\b(?:return\s+instance|return\s+this|return\s+[a-z_$][\w$]*|new\s+[A-Z][\w$]*\s*\()/.test(bodyLower);
}

function shouldCreateReturnedValueSurfaceCandidate(candidate: MethodCandidate): boolean {
    const codeLower = candidate.code.toLowerCase();
    const methodLower = candidate.method.toLowerCase();
    if (/^(create|build|make|init|new)[a-z0-9_$]*/.test(methodLower)) {
        return false;
    }
    if (isReflectOrMapDispatchReturn(candidate.code) || hasBridgeModelingSignal(candidate.code)) {
        return false;
    }
    if (!/\breturn\b/.test(codeLower)) {
        return false;
    }
    if (hasVoidLikeReturnType(candidate.returnType)) {
        return false;
    }
    const hasReturnedValueProducer = hasExternalOrFrameworkResponseProducer(candidate.code)
        || hasDelegatedReturnedValueProducer(candidate);
    if (!hasReturnedValueProducer) {
        return false;
    }
    for (const param of candidate.paramNames) {
        const escaped = escapeRegExp(param.toLowerCase());
        if (new RegExp(`\\breturn\\s+(?:promise\\.resolve\\s*\\(\\s*)?${escaped}\\s*\\)?\\s*(?:;|$)`).test(codeLower)) {
            return false;
        }
    }
    if (/\b(?:response|res|ret|result)\.data\b/.test(codeLower)) {
        return true;
    }
    if (/\.then\s*\([^)]*=>[\s\S]{0,1200}\breturn\s+[A-Za-z_$][\w$]*/.test(candidate.code)) {
        return true;
    }
    if (hasReturnedCallExpression(candidate.code)) {
        return true;
    }
    if (/\bjson\s*\.\s*parse\s*\(/.test(codeLower) && returnsNonParameterValue(candidate)) {
        return true;
    }
    if (/\b(?:fromjson|from_json|parse|decode|convert|torestdto|tomodel)\s*\(/.test(codeLower) && returnsNonParameterValue(candidate)) {
        return true;
    }
    return /\breturn\s+(?:credential|profile|token|data|result|response|res|ret)\b/.test(codeLower)
        || returnsNonParameterValue(candidate);
}

function hasExternalOrFrameworkResponseProducer(code: string): boolean {
    const text = String(code || "");
    if (/\b(?:await|return)\s+(?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/.test(text)) {
        return true;
    }
    return /\b(?:await|return)\s+new\s+[A-Za-z_$][\w$]*\s*\(/.test(text);
}

function isReflectOrMapDispatchReturn(code: string): boolean {
    const text = String(code || "");
    return /\bReflect\s*\.\s*get\s*\(/.test(text)
        || /\breturn\s+JSON\s*\.\s*stringify\s*\([^)]*\.call\s*\(/.test(text)
        || /\breturn\s+[A-Za-z_$][\w$]*\s*\.\s*get\s*\(/.test(text);
}

function hasVoidLikeReturnType(returnType?: string): boolean {
    const normalized = String(returnType || "")
        .replace(/\s+/g, "")
        .toLowerCase();
    return normalized === "void"
        || normalized === "undefined"
        || normalized === "promise<void>"
        || normalized === "promise<undefined>";
}

function hasDelegatedReturnedValueProducer(candidate: MethodCandidate): boolean {
    const code = String(candidate.code || "");
    if (!/\breturn\b/.test(code)) {
        return false;
    }
    return hasReturnedCallExpression(code)
        || (hasReceiverFieldCarrierSignal(code) && returnsNonParameterValue(candidate));
}

function returnsNonParameterValue(candidate: MethodCandidate): boolean {
    const params = new Set(candidate.paramNames.map(name => name.toLowerCase()));
    const returnExprs = [...candidate.code.matchAll(/\breturn\s+([^;\n]+)/gi)]
        .map(match => match[1].replace(/\s+/g, " ").trim())
        .filter(Boolean);
    for (const expr of returnExprs) {
        const lowered = expr.toLowerCase();
        if (!lowered || /^(true|false|null|undefined|void\b|0|1|"[^"]*"|'[^']*')/.test(lowered)) {
            continue;
        }
        const bare = lowered.match(/^(?:await\s+)?([a-z_$][\w$]*)\s*(?:\)|$)/i)?.[1];
        if (bare && params.has(bare)) {
            continue;
        }
        if (/^promise\.resolve\s*\(\s*([a-z_$][\w$]*)\s*\)/i.test(lowered)) {
            const resolved = lowered.match(/^promise\.resolve\s*\(\s*([a-z_$][\w$]*)\s*\)/i)?.[1];
            if (resolved && params.has(resolved)) {
                continue;
            }
        }
        return true;
    }
    return false;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProjectApiWrapperSignature(relFile: string, candidate: MethodCandidate, ownerOverride?: string): string {
    const args = Array.from({ length: Math.max(0, candidate.argCount) }, () => "Unknown").join(", ");
    const resolvedOwner = ownerOverride || candidate.owner;
    const owner = resolvedOwner
        ? `${resolvedOwner}${candidate.isStatic ? ".[static]" : "."}${candidate.method}`
        : candidate.method;
    return `@${normalizeSlashes(relFile)}: ${owner}(${args})`;
}

function lineTextAt(text: string, lineNumber: number): string {
    return (String(text || "").split(/\r?\n/)[Math.max(0, lineNumber - 1)] || "").trim();
}

function firstMeaningfulLine(code: string): string {
    const lines = String(code || "").split(/\r?\n/);
    for (const line of lines) {
        const stripped = line.replace(/^\s*\d+\s*\|\s*/, "").trim();
        if (stripped) return stripped.slice(0, 500);
    }
    return "";
}

function walkSourceFiles(absDir: string, out: string[], seen: Set<string>): void {
    const entries = safeReadDir(absDir);
    for (const entry of entries) {
        const abs = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                walkSourceFiles(abs, out, seen);
            }
            continue;
        }
        if (!entry.isFile() || !/\.(ets|ts)$/i.test(entry.name) || /\.d\.(ets|ts)$/i.test(entry.name)) continue;
        const resolved = path.resolve(abs);
        if (!seen.has(resolved)) {
            seen.add(resolved);
            out.push(resolved);
        }
    }
}

function safeReadDir(absDir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function readText(absFile: string): string | undefined {
    try {
        return fs.readFileSync(absFile, "utf-8");
    } catch {
        return undefined;
    }
}

function collectImportBindings(repoRoot: string, absFile: string, text: string): Map<string, ImportBinding> {
    const bindings = new Map<string, ImportBinding>();
    const defaultImport = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g;
    let defaultMatch: RegExpExecArray | null;
    while ((defaultMatch = defaultImport.exec(text)) !== null) {
        const name = defaultMatch[1].trim();
        const source = defaultMatch[2].trim();
        if (!name || !source) {
            continue;
        }
        const resolvedFile = resolveImportSource(repoRoot, absFile, source);
        bindings.set(name, {
            source,
            resolvedFile: resolvedFile ? resolveExportedSymbolFile(repoRoot, resolvedFile, name) || resolvedFile : undefined,
        });
    }
    const namedImport = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = namedImport.exec(text)) !== null) {
        const names = m[1].split(",")
            .map(part => part.trim().split(/\s+as\s+/i).pop() || "")
            .map(part => part.trim())
            .filter(Boolean);
        const source = m[2].trim();
        const resolvedFile = resolveImportSource(repoRoot, absFile, source);
        for (const name of names) {
            bindings.set(name, {
                source,
                resolvedFile: resolvedFile ? resolveExportedSymbolFile(repoRoot, resolvedFile, name) || resolvedFile : undefined,
            });
        }
    }
    return bindings;
}

function resolveImportSource(repoRoot: string, absFile: string, source: string): string | undefined {
    return source.startsWith(".")
        ? resolveRelativeImport(repoRoot, absFile, source)
        : resolvePackageImport(repoRoot, absFile, source);
}

function resolveRelativeImport(repoRoot: string, absFile: string, source: string): string | undefined {
    if (!source.startsWith(".")) {
        return undefined;
    }
    const base = path.resolve(path.dirname(absFile), source);
    const candidates = [
        base,
        `${base}.ets`,
        `${base}.ts`,
        path.join(base, "index.ets"),
        path.join(base, "index.ts"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return normalizeSlashes(path.relative(repoRoot, candidate));
        }
    }
    return undefined;
}

function resolvePackageImport(repoRoot: string, absFile: string, source: string): string | undefined {
    const parsed = parsePackageImportSource(source);
    if (!parsed) {
        return undefined;
    }
    const packageDir = resolveLocalFilePackageDir(repoRoot, absFile, parsed.packageName);
    if (!packageDir) {
        return undefined;
    }
    if (parsed.subpath) {
        return resolveImportPathFromBase(repoRoot, path.resolve(packageDir, parsed.subpath));
    }
    const manifest = readText(path.join(packageDir, "oh-package.json5"));
    const mainFile = extractJson5StringProperty(manifest || "", "main") || "Index.ets";
    return resolveImportPathFromBase(repoRoot, path.resolve(packageDir, mainFile));
}

function parsePackageImportSource(source: string): { packageName: string; subpath: string } | undefined {
    const text = String(source || "").trim();
    if (!text || text.startsWith(".")) {
        return undefined;
    }
    const parts = text.split("/").filter(Boolean);
    if (parts.length === 0) {
        return undefined;
    }
    if (parts[0].startsWith("@")) {
        if (parts.length < 2) {
            return undefined;
        }
        return {
            packageName: `${parts[0]}/${parts[1]}`,
            subpath: parts.slice(2).join("/"),
        };
    }
    return {
        packageName: parts[0],
        subpath: parts.slice(1).join("/"),
    };
}

function resolveLocalFilePackageDir(repoRoot: string, absFile: string, packageName: string): string | undefined {
    let current = path.dirname(absFile);
    const root = path.resolve(repoRoot);
    while (current.startsWith(root)) {
        const manifestPath = path.join(current, "oh-package.json5");
        const manifest = readText(manifestPath);
        const dependency = manifest ? extractFileDependency(manifest, packageName) : undefined;
        if (dependency) {
            const absPackageDir = path.resolve(current, dependency);
            if (fs.existsSync(absPackageDir) && fs.statSync(absPackageDir).isDirectory()) {
                return absPackageDir;
            }
        }
        if (current === root) {
            break;
        }
        const next = path.dirname(current);
        if (next === current) {
            break;
        }
        current = next;
    }
    return undefined;
}

function extractFileDependency(manifest: string, packageName: string): string | undefined {
    const escaped = escapeRegExp(packageName);
    const m = manifest.match(new RegExp(`["']${escaped}["']\\s*:\\s*["']file:([^"']+)["']`));
    return m ? m[1].trim() : undefined;
}

function extractJson5StringProperty(manifest: string, property: string): string | undefined {
    const escaped = escapeRegExp(property);
    const m = manifest.match(new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)["']`));
    return m ? m[1].trim() : undefined;
}

function resolveImportPathFromBase(repoRoot: string, base: string): string | undefined {
    const candidates = [
        base,
        `${base}.ets`,
        `${base}.ts`,
        path.join(base, "index.ets"),
        path.join(base, "index.ts"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return normalizeSlashes(path.relative(repoRoot, candidate));
        }
    }
    return undefined;
}

function resolveExportedSymbolFile(
    repoRoot: string,
    relFile: string,
    symbol: string,
    seen: Set<string> = new Set(),
): string | undefined {
    const normalized = normalizeSlashes(relFile);
    if (seen.has(normalized)) {
        return undefined;
    }
    seen.add(normalized);
    const absFile = path.resolve(repoRoot, normalized);
    const text = readText(absFile);
    if (!text) {
        return undefined;
    }
    if (fileDefinesExportedSymbol(text, symbol)) {
        return normalized;
    }
    const namedExport = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = namedExport.exec(text)) !== null) {
        const names = parseExportedNames(m[1]);
        if (!names.has(symbol)) {
            continue;
        }
        const target = resolveImportSource(repoRoot, absFile, m[2].trim());
        const resolved = target ? resolveExportedSymbolFile(repoRoot, target, symbol, seen) || target : undefined;
        if (resolved) {
            return resolved;
        }
    }
    const starExport = /export\s*\*\s*from\s*["']([^"']+)["']/g;
    while ((m = starExport.exec(text)) !== null) {
        const target = resolveImportSource(repoRoot, absFile, m[1].trim());
        const resolved = target ? resolveExportedSymbolFile(repoRoot, target, symbol, seen) : undefined;
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}

function fileDefinesExportedSymbol(text: string, symbol: string): boolean {
    const escaped = escapeRegExp(symbol);
    return new RegExp(`\\bexport\\s+(?:default\\s+)?(?:struct|class|function|interface|enum|const|let|var)\\s+${escaped}\\b`).test(text);
}

function parseExportedNames(exportList: string): Set<string> {
    const out = new Set<string>();
    for (const raw of exportList.split(",")) {
        const part = raw.trim();
        if (!part) {
            continue;
        }
        const alias = part.split(/\s+as\s+/i).map(value => value.trim()).filter(Boolean);
        out.add(alias[alias.length - 1] || part);
    }
    return out;
}

function readExportedSymbolSnippet(repoRoot: string, relFile: string, symbol: string): string | undefined {
    const absFile = path.resolve(repoRoot, relFile);
    const text = readText(absFile);
    if (!text) {
        return undefined;
    }
    const pattern = new RegExp(`\\bexport\\s+(?:default\\s+)?(?:struct|class|function)\\s+${escapeRegExp(symbol)}\\b`);
    const m = pattern.exec(text);
    if (!m) {
        return text.split(/\r?\n/).slice(0, 80).join("\n");
    }
    const startLine = lineNumberAt(text, m.index);
    return formatLineWindow(text, startLine, 20);
}

interface OptionCallbackCall {
    callee: string;
    start: number;
    statementText: string;
    callbackProperties: string[];
}

interface MethodCallbackCall {
    receiver: string;
    method: string;
    start: number;
    statementText: string;
    argCount: number;
    callbackArgIndexes: number[];
    typeHint?: string;
}

function collectOptionCallbackCalls(text: string): OptionCallbackCall[] {
    const out: OptionCallbackCall[] = [];
    const callRe = /\b([A-Z][A-Za-z0-9_$]*)\s*\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text)) !== null) {
        const callee = m[1];
        const openBrace = text.indexOf("{", m.index);
        if (openBrace < 0) continue;
        const closeBrace = findMatchingBrace(text, openBrace);
        if (closeBrace < 0) continue;
        const objectText = text.slice(openBrace, closeBrace + 1);
        const callbackProperties = extractCallbackProperties(objectText);
        if (callbackProperties.length === 0) continue;
        const statementEnd = findStatementEnd(text, closeBrace);
        out.push({
            callee,
            start: m.index,
            statementText: text.slice(m.index, statementEnd),
            callbackProperties,
        });
        callRe.lastIndex = Math.max(callRe.lastIndex, closeBrace + 1);
    }
    return out;
}

function collectMethodCallbackCalls(text: string): MethodCallbackCall[] {
    const out: MethodCallbackCall[] = [];
    const callRe = /\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*){0,5})\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text)) !== null) {
        const receiver = m[1].replace(/\s+/g, "");
        const method = m[2];
        if (!isModelingRelevantMethodCallback(receiver, method)) continue;

        const openParen = text.indexOf("(", m.index + m[0].lastIndexOf(method));
        if (openParen < 0) continue;
        const closeParen = findMatchingParen(text, openParen);
        if (closeParen < 0) continue;

        const argsText = text.slice(openParen + 1, closeParen);
        const args = splitTopLevelArguments(argsText);
        const callbackArgIndexes = args
            .map((arg, index) => isInlineCallbackArgument(arg) ? index : -1)
            .filter(index => index >= 0);
        if (callbackArgIndexes.length === 0) continue;

        const statementEnd = findStatementEnd(text, closeParen);
        out.push({
            receiver,
            method,
            start: m.index,
            statementText: text.slice(m.index, statementEnd),
            argCount: args.length,
            callbackArgIndexes,
            typeHint: inferMethodCallbackTypeHint(receiver, method),
        });
        callRe.lastIndex = Math.max(callRe.lastIndex, closeParen + 1);
    }
    return out;
}

function isModelingRelevantMethodCallback(receiver: string, method: string): boolean {
    const loweredReceiver = receiver.toLowerCase();
    const loweredMethod = method.toLowerCase();
    if (loweredMethod === "use" && loweredReceiver.includes("interceptors")) {
        return loweredReceiver.includes(".response");
    }
    return /^(on|once|subscribe|addlistener|addeventlistener|register|listen)$/.test(loweredMethod);
}

function inferMethodCallbackTypeHint(receiver: string, method: string): string | undefined {
    const lowered = `${receiver}.${method}`.toLowerCase();
    if (lowered.includes("interceptors.response")) return "interceptors.response";
    if (lowered.includes("interceptors.request")) return "interceptors.request";
    if (lowered.includes("interceptors")) return "interceptors";
    if (hasAnyReceiverToken(receiver, ["event", "emitter", "hub", "bus", "channel"])) return "event";
    return undefined;
}

function hasAnyReceiverToken(receiver: string, expected: string[]): boolean {
    const tokens = receiverSemanticTokens(receiver);
    return expected.some(token => tokens.has(token));
}

function receiverSemanticTokens(receiver: string): Set<string> {
    const text = String(receiver || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase();
    return new Set(text.split(/[^a-z0-9]+/).map(token => token.trim()).filter(Boolean));
}

function isInlineCallbackArgument(arg: string): boolean {
    const text = arg.trim();
    if (!text) return false;
    return /=>/.test(text) || /^\s*(?:async\s+)?function\b/.test(text);
}

function splitTopLevelArguments(argsText: string): string[] {
    const out: string[] = [];
    let current = "";
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;
    for (let i = 0; i < argsText.length; i++) {
        const ch = argsText[i];
        const next = argsText[i + 1];
        if (lineComment) {
            current += ch;
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            current += ch;
            if (ch === "*" && next === "/") {
                current += next;
                i++;
                blockComment = false;
            }
            continue;
        }
        if (quote) {
            current += ch;
            if (ch === "\\") {
                current += next || "";
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "/" && next === "/") {
            current += ch + next;
            i++;
            lineComment = true;
            continue;
        }
        if (ch === "/" && next === "*") {
            current += ch + next;
            i++;
            blockComment = true;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) {
            depth--;
        } else if (ch === "," && depth === 0) {
            out.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        out.push(current.trim());
    }
    return out;
}

function findMatchingParen(text: string, openIndex: number): number {
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (lineComment) {
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === "*" && next === "/") {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "/" && next === "/") {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "(") depth++;
        if (ch === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findMatchingBrace(text: string, openIndex: number): number {
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (lineComment) {
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === "*" && next === "/") {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "/" && next === "/") {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "{") depth++;
        if (ch === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findStatementEnd(text: string, fromIndex: number): number {
    const semi = text.indexOf(";", fromIndex);
    const newline = text.indexOf("\n", fromIndex);
    const candidates = [semi, newline].filter(v => v >= 0);
    return candidates.length > 0 ? Math.min(...candidates) + 1 : Math.min(text.length, fromIndex + 1);
}

function extractCallbackProperties(objectText: string): string[] {
    const out = new Set<string>();
    const arrow = /\b(on[A-Z][A-Za-z0-9_$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+)?\s*=>/g;
    let m: RegExpExecArray | null;
    while ((m = arrow.exec(objectText)) !== null) {
        out.add(m[1]);
    }
    const reference = /\b(on[A-Z][A-Za-z0-9_$]*)\s*:\s*(?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:\s*,|\s*\})/g;
    while ((m = reference.exec(objectText)) !== null) {
        out.add(m[1]);
    }
    return [...out].sort();
}

function isModelingRelevantCallback(name: string): boolean {
    return /^on[A-Z]/.test(name);
}


function lineNumberAt(text: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) {
        if (text[i] === "\n") line++;
    }
    return line;
}

function formatLineWindow(text: string, centerLine: number, radius: number): string {
    const lines = text.split(/\r?\n/);
    const start = Math.max(1, centerLine - radius);
    const end = Math.min(lines.length, centerLine + radius);
    const out: string[] = [];
    for (let line = start; line <= end; line++) {
        out.push(`${String(line).padStart(5, " ")} | ${lines[line - 1] ?? ""}`);
    }
    return out.join("\n");
}

function compactWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}
