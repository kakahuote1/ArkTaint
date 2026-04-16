import * as fs from "fs";
import * as path from "path";
import { createSemanticFlowDraftId } from "../../core/semanticflow/SemanticFlowIncremental";
import {
    createSemanticFlowLlmDecider,
    SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION,
    SEMANTIC_FLOW_LLM_TEMPERATURE,
} from "../../core/semanticflow/SemanticFlowLlm";
import { runSemanticFlowPipeline } from "../../core/semanticflow/SemanticFlowPipeline";
import { SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION } from "../../core/semanticflow/SemanticFlowPrompt";
import { getSemanticFlowItemCacheSemanticsFingerprint } from "../../core/semanticflow/SemanticFlowSessionSemantics";
import {
    buildSemanticFlowItemCacheKey,
    SEMANTIC_FLOW_SESSION_CACHE_KIND,
    SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
    SemanticFlowSessionCache,
} from "../../core/semanticflow/SemanticFlowSessionCache";
import type {
    SemanticFlowAnchor,
    SemanticFlowDecisionInput,
    SemanticFlowExpander,
    SemanticFlowSlicePackage,
} from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function assertThrows(action: () => void, expectedFragment: string): void {
    try {
        action();
    } catch (error) {
        const detail = String((error as any)?.message || error);
        assert(
            detail.includes(expectedFragment),
            `expected error to include "${expectedFragment}", got "${detail}"`,
        );
        return;
    }
    throw new Error(`expected throw containing "${expectedFragment}"`);
}

function extractRound(user: string): number {
    const match = user.match(/^round:\s*(\d+)$/m);
    return match?.[1] ? Number(match[1]) : 0;
}

function resetDir(dirPath: string): void {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

function buildAnchor(id: string, surface: string): SemanticFlowAnchor {
    return {
        id,
        owner: "CacheOwner",
        surface,
        methodSignature: `@project/cache.ts: CacheOwner.${surface}(string)`,
        filePath: "cache.ts",
        line: 1,
    };
}

function buildSlice(anchorId: string, round = 0, snippetCode = "cacheAnchor(value)"): SemanticFlowSlicePackage {
    return {
        anchorId,
        round,
        template: "call-return",
        observations: [`observation:${anchorId}:${round}`],
        snippets: [{ label: "anchor", code: snippetCode }],
        companions: [],
        notes: [],
    };
}

function buildDecisionInput(anchor: SemanticFlowAnchor, slice: SemanticFlowSlicePackage): SemanticFlowDecisionInput {
    return {
        anchor,
        draftId: createSemanticFlowDraftId(anchor),
        slice,
        round: slice.round,
        history: [],
    };
}

function readAllJsonText(rootDir: string): string[] {
    const out: string[] = [];
    const queue = [rootDir];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        if (!fs.existsSync(current)) {
            continue;
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".json")) {
                out.push(fs.readFileSync(fullPath, "utf8"));
            }
        }
    }
    return out;
}

function listJsonFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }
    return fs.readdirSync(dirPath)
        .filter(name => name.endsWith(".json"))
        .sort()
        .map(name => path.join(dirPath, name));
}

function writeMinimalSessionCacheSchema(rootDir: string): void {
    fs.writeFileSync(path.join(rootDir, "schema.json"), JSON.stringify({
        schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
        cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
        createdAt: new Date(0).toISOString(),
        decisionKeyFields: [],
        itemKeyFields: [],
        storedArtifacts: [],
    }, null, 2), "utf8");
}

function testSemanticFlowSessionCacheModeGuardrails(rootDir: string): void {
    const missingReadRoot = path.join(rootDir, "read_mode_missing_root");
    fs.rmSync(missingReadRoot, { recursive: true, force: true });
    assertThrows(
        () => new SemanticFlowSessionCache({ rootDir: missingReadRoot, mode: "read" }),
        "root missing for read mode",
    );

    const invalidDecisionsRoot = path.join(rootDir, "invalid_decisions_dir");
    resetDir(invalidDecisionsRoot);
    writeMinimalSessionCacheSchema(invalidDecisionsRoot);
    fs.writeFileSync(path.join(invalidDecisionsRoot, "decisions"), "not-a-directory", "utf8");
    assertThrows(
        () => new SemanticFlowSessionCache({ rootDir: invalidDecisionsRoot, mode: "read" }),
        "decisions path is not a directory",
    );

    const writableRoot = path.join(rootDir, "artifact_paths");
    resetDir(writableRoot);
    const cache = new SemanticFlowSessionCache({
        rootDir: writableRoot,
        mode: "rw",
    });
    const artifacts = cache.getArtifactPaths();
    assert(artifacts.rootDir === writableRoot, "artifact rootDir mismatch");
    assert(artifacts.schemaPath === path.join(writableRoot, "schema.json"), "artifact schemaPath mismatch");
    assert(artifacts.statsPath === path.join(writableRoot, "stats.json"), "artifact statsPath mismatch");
    assert(artifacts.decisionsDir === path.join(writableRoot, "decisions"), "artifact decisionsDir mismatch");
    assert(artifacts.itemsDir === path.join(writableRoot, "items"), "artifact itemsDir mismatch");
    assert(artifacts.anchorsDir === path.join(writableRoot, "anchors"), "artifact anchorsDir mismatch");
}

async function testSemanticFlowLlmSessionCacheHit(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "decision_hit");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.hit.anchor", "copyValue");
    const slice = buildSlice(anchor.id);
    let modelCalls = 0;
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    const decider = createSemanticFlowLlmDecider({
        model: "mock-cache-hit",
        sessionCache: cache,
        async modelInvoker() {
            modelCalls++;
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [{ slot: "arg", index: 0 }],
                    outputs: [{ slot: "result" }],
                    transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                    confidence: "high",
                    ruleKind: "transfer",
                },
            });
        },
    });

    const first = await decider.decide(buildDecisionInput(anchor, slice));
    const second = await decider.decide(buildDecisionInput(anchor, slice));
    const stats = cache.getStats();

    assert(first.status === "done", "expected first cached decision to resolve");
    assert(second.status === "done", "expected second cached decision to resolve");
    assert(modelCalls === 1, `expected one LLM call after cache hit, got ${modelCalls}`);
    assert(stats.llmCacheHitCount === 1, `expected llmCacheHitCount=1, got ${stats.llmCacheHitCount}`);
    assert(stats.llmCacheMissCount === 1, `expected llmCacheMissCount=1, got ${stats.llmCacheMissCount}`);
    assert(stats.llmCacheWriteCount === 1, `expected llmCacheWriteCount=1, got ${stats.llmCacheWriteCount}`);
}

async function testSemanticFlowLlmSessionCacheInvalidateModel(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "invalidate_model");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.invalidate.anchor", "copyValue");
    const slice = buildSlice(anchor.id);
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    const counterA = { value: 0 };
    const counterB = { value: 0 };

    const makeDecider = (model: string, counter: { value: number }) => createSemanticFlowLlmDecider({
        model,
        sessionCache: cache,
        async modelInvoker() {
            counter.value++;
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [{ slot: "arg", index: 0 }],
                    outputs: [{ slot: "result" }],
                    transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                    confidence: "high",
                    ruleKind: "transfer",
                },
            });
        },
    });

    await makeDecider("mock-cache-model-a", counterA).decide(buildDecisionInput(anchor, slice));
    await makeDecider("mock-cache-model-b", counterB).decide(buildDecisionInput(anchor, slice));
    const stats = cache.getStats();

    assert(counterA.value === 1, `expected model A to miss cache once, got ${counterA.value}`);
    assert(counterB.value === 1, `expected model B to miss cache once, got ${counterB.value}`);
    assert(stats.llmCacheMissCount === 2, `expected llmCacheMissCount=2, got ${stats.llmCacheMissCount}`);
    assert(stats.llmCacheWriteCount === 2, `expected llmCacheWriteCount=2, got ${stats.llmCacheWriteCount}`);
}

async function testSemanticFlowSessionCacheWriteModeSkipsRead(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "write_mode_skips_read");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.write_mode.anchor", "copyValue");
    const slice = buildSlice(anchor.id);
    const seedCache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    const seedDecider = createSemanticFlowLlmDecider({
        model: "mock-cache-write-mode",
        sessionCache: seedCache,
        async modelInvoker() {
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [{ slot: "arg", index: 0 }],
                    outputs: [{ slot: "result" }],
                    transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                    confidence: "high",
                    ruleKind: "transfer",
                },
            });
        },
    });
    await seedDecider.decide(buildDecisionInput(anchor, slice));

    let modelCalls = 0;
    const writeOnlyCache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "write",
    });
    const writeOnlyDecider = createSemanticFlowLlmDecider({
        model: "mock-cache-write-mode",
        sessionCache: writeOnlyCache,
        async modelInvoker() {
            modelCalls++;
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [{ slot: "arg", index: 0 }],
                    outputs: [{ slot: "result" }],
                    transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                    confidence: "high",
                    ruleKind: "transfer",
                },
            });
        },
    });

    await writeOnlyDecider.decide(buildDecisionInput(anchor, slice));
    await writeOnlyDecider.decide(buildDecisionInput(anchor, slice));
    const stats = writeOnlyCache.getStats();

    assert(modelCalls === 2, `expected write-only mode to bypass cache reads, got ${modelCalls}`);
    assert(stats.llmCacheHitCount === 0, `expected write-only mode llmCacheHitCount=0, got ${stats.llmCacheHitCount}`);
    assert(stats.llmCacheMissCount === 0, `expected write-only mode llmCacheMissCount=0, got ${stats.llmCacheMissCount}`);
    assert(stats.llmCacheWriteCount === 2, `expected write-only mode llmCacheWriteCount=2, got ${stats.llmCacheWriteCount}`);
}

async function testSemanticFlowSessionCacheReadModeSkipsWrite(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "read_mode_skips_write");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.read_mode.anchor", "copyValue");
    const slice = buildSlice(anchor.id);
    const seedCache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    const seedDecider = createSemanticFlowLlmDecider({
        model: "mock-cache-read-mode",
        sessionCache: seedCache,
        async modelInvoker() {
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [{ slot: "arg", index: 0 }],
                    outputs: [{ slot: "result" }],
                    transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                    confidence: "high",
                    ruleKind: "transfer",
                },
            });
        },
    });
    await seedDecider.decide(buildDecisionInput(anchor, slice));

    const seededArtifacts = seedCache.getArtifactPaths();
    const decisionFiles = listJsonFiles(seededArtifacts.decisionsDir);
    assert(decisionFiles.length === 1, `expected exactly one seeded decision file, got ${decisionFiles.length}`);
    const decisionBefore = fs.readFileSync(decisionFiles[0], "utf8");
    const statsBefore = fs.readFileSync(seededArtifacts.statsPath, "utf8");

    let modelCalls = 0;
    const readOnlyCache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "read",
    });
    const readOnlyDecider = createSemanticFlowLlmDecider({
        model: "mock-cache-read-mode",
        sessionCache: readOnlyCache,
        async modelInvoker() {
            modelCalls++;
            throw new Error("read-only mode should hit cache before invoking model");
        },
    });

    const decision = await readOnlyDecider.decide(buildDecisionInput(anchor, slice));
    const stats = readOnlyCache.getStats();
    const decisionAfter = fs.readFileSync(decisionFiles[0], "utf8");
    const statsAfter = fs.readFileSync(seededArtifacts.statsPath, "utf8");

    assert(decision.status === "done", "expected read-only mode to return cached decision");
    assert(modelCalls === 0, `expected read-only mode to skip model calls, got ${modelCalls}`);
    assert(stats.llmCacheHitCount === 1, `expected read-only mode llmCacheHitCount=1, got ${stats.llmCacheHitCount}`);
    assert(stats.llmCacheWriteCount === 0, `expected read-only mode llmCacheWriteCount=0, got ${stats.llmCacheWriteCount}`);
    assert(decisionAfter === decisionBefore, "read-only mode should not rewrite decision cache file");
    assert(statsAfter === statsBefore, "read-only mode should not rewrite persisted stats file");
}

async function testSemanticFlowLlmSessionCacheNoRaw(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "no_raw");
    resetDir(cacheRoot);
    const snippetSentinel = "NO_RAW_SNIPPET_SENTINEL_2f63098d";
    const expandedSentinel = "NO_RAW_EXPANDED_SENTINEL_6ac4dc79";
    const anchor = buildAnchor("cache.no_raw.anchor", "emitValue");
    const initialSlice = buildSlice(anchor.id, 0, snippetSentinel);
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    let modelCalls = 0;
    const decider = createSemanticFlowLlmDecider({
        model: "mock-cache-no-raw",
        sessionCache: cache,
        async modelInvoker(input) {
            modelCalls++;
            const round = extractRound(input.user);
            if (round === 0) {
                return [
                    "```json",
                    JSON.stringify({
                        status: "need-more-evidence",
                        draft: {
                            inputs: [{ slot: "arg", index: 0 }],
                            outputs: [{ slot: "result" }],
                            transfers: [],
                            confidence: "medium",
                            ruleKind: "transfer",
                        },
                        request: {
                            kind: "q_wrap",
                            focus: {
                                from: "arg0",
                                to: "ret",
                            },
                            scope: {
                                owner: "CacheOwner",
                                locality: "method",
                                surface: "emitValue",
                            },
                            budgetClass: "body_local",
                            why: ["need direct wrapper evidence"],
                            ask: "show the wrapper body",
                        },
                    }, null, 2),
                    "```",
                ].join("\n");
            }
            return [
                "```json",
                JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [{ slot: "result" }],
                        transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                        confidence: "high",
                        ruleKind: "transfer",
                    },
                }, null, 2),
                "```",
            ].join("\n");
        },
    });
    const expander: SemanticFlowExpander = {
        async expand(input) {
            return {
                slice: {
                    ...input.slice,
                    round: input.round + 1,
                    observations: [...input.slice.observations, "wrapper body recovered"],
                    snippets: [...input.slice.snippets, { label: "expanded", code: expandedSentinel }],
                    notes: [...(input.slice.notes || []), input.deficit.ask],
                },
                delta: {
                    id: "delta.cache.no_raw",
                    newObservations: ["wrapper body recovered"],
                    newSnippets: [{ label: "expanded", code: expandedSentinel }],
                    newCompanions: [],
                    effective: true,
                },
            };
        },
    };

    const result = await runSemanticFlowPipeline(
        [{ anchor, initialSlice }],
        decider,
        expander,
        {
            maxRounds: 1,
            model: "mock-cache-no-raw",
            sessionCache: cache,
        },
    );

    assert(result.items[0]?.resolution === "resolved", "expected no-raw pipeline result to resolve");
    assert(modelCalls === 2, `expected two LLM calls for no-raw pipeline, got ${modelCalls}`);
    const texts = readAllJsonText(cacheRoot);
    assert(texts.length >= 5, `expected cache JSON artifacts to be written, got ${texts.length}`);
    for (const text of texts) {
        assert(!text.includes(snippetSentinel), "cache file leaked original slice snippet text");
        assert(!text.includes(expandedSentinel), "cache file leaked expanded snippet text");
        assert(!text.includes("```json"), "cache file leaked raw fenced model response");
        assert(!text.includes("You classify one API semantic slice for static taint modeling."), "cache file leaked prompt system text");
    }
}

async function testSemanticFlowItemCacheShortcut(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "item_shortcut");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.item.anchor", "emitValue");
    const initialSlice: SemanticFlowSlicePackage = {
        ...buildSlice(anchor.id, 0, "itemShortcut(value)"),
        companions: ["CacheOwner.helper"],
        notes: ["initial wrapper evidence"],
    };
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });

    let firstModelCalls = 0;
    let firstExpandCalls = 0;
    const firstDecider = createSemanticFlowLlmDecider({
        model: "mock-item-shortcut",
        sessionCache: cache,
        async modelInvoker(input) {
            firstModelCalls++;
            const round = extractRound(input.user);
            if (round === 0) {
                return JSON.stringify({
                    status: "need-more-evidence",
                    draft: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [{ slot: "result" }],
                        transfers: [],
                        confidence: "medium",
                        ruleKind: "transfer",
                    },
                    request: {
                        kind: "q_wrap",
                        focus: {
                            from: "arg0",
                            to: "ret",
                        },
                        scope: {
                            owner: "CacheOwner",
                            locality: "method",
                            surface: "emitValue",
                        },
                        budgetClass: "body_local",
                        why: ["need wrapper body"],
                        ask: "show the wrapper body",
                    },
                });
            }
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [{ slot: "arg", index: 0 }],
                    outputs: [{ slot: "result" }],
                    transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                    confidence: "high",
                    ruleKind: "transfer",
                },
            });
        },
    });
    const firstExpander: SemanticFlowExpander = {
        async expand(input) {
            firstExpandCalls++;
            return {
                slice: {
                    ...input.slice,
                    round: input.round + 1,
                    observations: [...input.slice.observations, "wrapper body recovered"],
                    snippets: [...input.slice.snippets, { label: "expanded", code: "expandedShortcut(value)" }],
                    companions: [...(input.slice.companions || []), "CacheOwner.emitValue$expanded"],
                    notes: [...(input.slice.notes || []), input.deficit.ask],
                },
                delta: {
                    id: "delta.cache.item.shortcut",
                    newObservations: ["wrapper body recovered"],
                    newSnippets: [{ label: "expanded", code: "expandedShortcut(value)" }],
                    newCompanions: ["CacheOwner.emitValue$expanded"],
                    effective: true,
                },
            };
        },
    };

    const firstRun = await runSemanticFlowPipeline(
        [{ anchor, initialSlice }],
        firstDecider,
        firstExpander,
        {
            maxRounds: 1,
            model: "mock-item-shortcut",
            sessionCache: cache,
        },
    );
    assert(firstRun.items[0]?.lastMarker?.kind === "q_wrap", "expected first item-cache run to retain last marker");
    assert(firstRun.items[0]?.lastDelta?.id === "delta.cache.item.shortcut", "expected first item-cache run to retain last delta");
    assert(firstRun.items[0]?.history[0]?.deficit?.kind === "q_wrap", "expected first item-cache run to retain deficit");
    assert(Boolean(firstRun.items[0]?.history[0]?.plan), "expected first item-cache run to retain plan");
    assert(firstRun.items[0]?.history[0]?.delta?.id === "delta.cache.item.shortcut", "expected first item-cache run to retain delta");
    assert(Boolean(firstRun.items[0]?.history[0]?.marker?.deltaId), "expected first item-cache run to retain marker");
    assert(firstRun.items[0]?.resolution === "resolved", "expected first item-cache run to resolve");
    assert(firstModelCalls === 2, `expected first item-cache run to call LLM twice, got ${firstModelCalls}`);
    assert(firstExpandCalls === 1, `expected first item-cache run to expand once, got ${firstExpandCalls}`);
    assert(
        cache.lookupItem(buildSemanticFlowItemCacheKey({
            model: "mock-item-shortcut",
            temperature: SEMANTIC_FLOW_LLM_TEMPERATURE + 1,
            promptSchemaVersion: SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
            parserSchemaVersion: SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION,
            semanticsFingerprint: getSemanticFlowItemCacheSemanticsFingerprint(),
            anchor,
            initialSlice,
            maxRounds: 1,
        })) === undefined,
        "expected temperature change to invalidate item cache",
    );
    assert(
        cache.lookupItem(buildSemanticFlowItemCacheKey({
            model: "mock-item-shortcut",
            temperature: SEMANTIC_FLOW_LLM_TEMPERATURE,
            promptSchemaVersion: SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION + 1,
            parserSchemaVersion: SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION,
            semanticsFingerprint: getSemanticFlowItemCacheSemanticsFingerprint(),
            anchor,
            initialSlice,
            maxRounds: 1,
        })) === undefined,
        "expected prompt schema change to invalidate item cache",
    );
    assert(
        cache.lookupItem(buildSemanticFlowItemCacheKey({
            model: "mock-item-shortcut",
            temperature: SEMANTIC_FLOW_LLM_TEMPERATURE,
            promptSchemaVersion: SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
            parserSchemaVersion: SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION + 1,
            semanticsFingerprint: getSemanticFlowItemCacheSemanticsFingerprint(),
            anchor,
            initialSlice,
            maxRounds: 1,
        })) === undefined,
        "expected parser schema change to invalidate item cache",
    );
    assert(
        cache.lookupItem(buildSemanticFlowItemCacheKey({
            model: "mock-item-shortcut",
            temperature: SEMANTIC_FLOW_LLM_TEMPERATURE,
            promptSchemaVersion: SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
            parserSchemaVersion: SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION,
            semanticsFingerprint: `${getSemanticFlowItemCacheSemanticsFingerprint()}-changed`,
            anchor,
            initialSlice,
            maxRounds: 1,
        })) === undefined,
        "expected item semantics fingerprint change to invalidate item cache",
    );

    let secondModelCalls = 0;
    let secondExpandCalls = 0;
    const secondDecider = createSemanticFlowLlmDecider({
        model: "mock-item-shortcut",
        sessionCache: cache,
        async modelInvoker() {
            secondModelCalls++;
            throw new Error("item cache hit should bypass the LLM");
        },
    });
    const secondExpander: SemanticFlowExpander = {
        async expand() {
            secondExpandCalls++;
            throw new Error("item cache hit should bypass the expander");
        },
    };

    const secondRun = await runSemanticFlowPipeline(
        [{ anchor, initialSlice }],
        secondDecider,
        secondExpander,
        {
            maxRounds: 1,
            model: "mock-item-shortcut",
            sessionCache: cache,
        },
    );
    const stats = cache.getStats();

    assert(secondRun.items[0]?.resolution === "resolved", "expected cached item run to resolve");
    assert(secondRun.items[0]?.classification === "rule", "expected cached item run to preserve classification");
    assert((secondRun.items[0]?.history.length || 0) === 2, "expected cached item run to restore round history");
    assert(secondRun.items[0]?.lastMarker?.kind === "q_wrap", "expected cached item run to restore last marker");
    assert(secondRun.items[0]?.lastDelta?.id === "delta.cache.item.shortcut", "expected cached item run to restore last delta");
    assert(secondRun.items[0]?.history[0]?.deficit?.kind === "q_wrap", "expected cached item run to restore deficit");
    assert(Boolean(secondRun.items[0]?.history[0]?.plan), "expected cached item run to restore plan");
    assert(secondRun.items[0]?.history[0]?.delta?.id === "delta.cache.item.shortcut", "expected cached item run to restore delta");
    assert(Boolean(secondRun.items[0]?.history[0]?.marker?.deltaId), "expected cached item run to restore marker");
    assert(secondRun.items[0]?.history[0]?.slice.observations[0] === `observation:${anchor.id}:0`, "expected cached item run to restore round-0 observations");
    assert(secondRun.items[0]?.history[0]?.slice.snippets[0]?.label === "anchor", "expected cached item run to restore round-0 snippet label");
    assert(secondRun.items[0]?.history[0]?.slice.snippets[0]?.code === "", "expected cached item run to redact round-0 snippet code");
    assert(secondRun.items[0]?.history[0]?.slice.companions[0] === "CacheOwner.helper", "expected cached item run to restore round-0 companions");
    assert(secondRun.items[0]?.history[0]?.slice.notes[0] === "initial wrapper evidence", "expected cached item run to restore round-0 notes");
    assert(secondRun.items[0]?.history[1]?.slice.observations.includes("wrapper body recovered"), "expected cached item run to restore expanded observations");
    assert(secondRun.items[0]?.history[1]?.slice.snippets[1]?.label === "expanded", "expected cached item run to restore expanded snippet label");
    assert(secondRun.items[0]?.history[1]?.slice.snippets[1]?.code === "", "expected cached item run to redact expanded snippet code");
    assert(secondRun.items[0]?.history[1]?.slice.companions.includes("CacheOwner.emitValue$expanded"), "expected cached item run to restore expanded companions");
    assert(secondRun.items[0]?.history[1]?.slice.notes.includes("show the wrapper body"), "expected cached item run to restore expanded notes");
    assert(secondRun.items[0]?.finalSlice.observations.includes("wrapper body recovered"), "expected cached item run to restore final slice observations");
    assert(secondRun.items[0]?.finalSlice.snippets[0]?.label === "anchor", "expected cached item run to restore final slice anchor snippet label");
    assert(secondRun.items[0]?.finalSlice.snippets[0]?.code === "", "expected cached item run to redact final slice anchor snippet code");
    assert(secondRun.items[0]?.finalSlice.snippets[1]?.label === "expanded", "expected cached item run to restore final slice expanded snippet label");
    assert(secondRun.items[0]?.finalSlice.snippets[1]?.code === "", "expected cached item run to redact final slice expanded snippet code");
    assert(secondRun.items[0]?.finalSlice.companions.includes("CacheOwner.helper"), "expected cached item run to restore final slice companions");
    assert(secondRun.items[0]?.finalSlice.companions.includes("CacheOwner.emitValue$expanded"), "expected cached item run to restore final slice expanded companions");
    assert(secondRun.items[0]?.finalSlice.notes.includes("initial wrapper evidence"), "expected cached item run to restore final slice initial notes");
    assert(secondRun.items[0]?.finalSlice.notes.includes("show the wrapper body"), "expected cached item run to restore final slice expanded notes");
    assert(secondModelCalls === 0, `expected cached item run to skip LLM, got ${secondModelCalls}`);
    assert(secondExpandCalls === 0, `expected cached item run to skip expander, got ${secondExpandCalls}`);
    assert(stats.itemCacheHitCount === 1, `expected itemCacheHitCount=1, got ${stats.itemCacheHitCount}`);
    const artifacts = cache.getArtifactPaths();
    const itemFiles = listJsonFiles(artifacts.itemsDir);
    assert(itemFiles.length === 1, `expected exactly one cached item file, got ${itemFiles.length}`);
    const itemCacheText = fs.readFileSync(itemFiles[0], "utf8");
    assert(itemCacheText.includes("wrapper body recovered"), "expected cached item file to retain slice observations");
    assert(itemCacheText.includes("initial wrapper evidence"), "expected cached item file to retain slice notes");
    assert(itemCacheText.includes("CacheOwner.emitValue$expanded"), "expected cached item file to retain slice companions");
    assert(itemCacheText.includes("\"label\": \"anchor\""), "expected cached item file to retain anchor snippet labels");
    assert(itemCacheText.includes("\"label\": \"expanded\""), "expected cached item file to retain expanded snippet labels");
    assert(!itemCacheText.includes("itemShortcut(value)"), "cached item file leaked original anchor code");
    assert(!itemCacheText.includes("expandedShortcut(value)"), "cached item file leaked expanded anchor code");
}

async function main(): Promise<void> {
    const rootDir = path.resolve("tmp/test_runs/runtime/semanticflow_llm_session_cache/latest");
    resetDir(rootDir);

    testSemanticFlowSessionCacheModeGuardrails(rootDir);
    await testSemanticFlowLlmSessionCacheHit(rootDir);
    await testSemanticFlowLlmSessionCacheInvalidateModel(rootDir);
    await testSemanticFlowSessionCacheWriteModeSkipsRead(rootDir);
    await testSemanticFlowSessionCacheReadModeSkipsWrite(rootDir);
    await testSemanticFlowLlmSessionCacheNoRaw(rootDir);
    await testSemanticFlowItemCacheShortcut(rootDir);

    console.log("PASS test_semanticflow_llm_session_cache");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_llm_session_cache");
    console.error(error);
    process.exit(1);
});
