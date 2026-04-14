import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { buildArkMainEntryCandidates } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateBuilder";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import { createSemanticFlowLlmDecider } from "../../core/semanticflow/SemanticFlowLlm";
import { runSemanticFlowPipeline, runSemanticFlowSession, type SemanticFlowPipelineItemInput } from "../../core/semanticflow/SemanticFlowPipeline";
import { runSemanticFlowAnalysis } from "../../core/semanticflow/SemanticFlowRuntime";
import type { SemanticFlowExpander } from "../../core/semanticflow/SemanticFlowTypes";
import { compileModuleSpec } from "../../core/orchestration/modules/ModuleSpecCompiler";
import { normalizeNoCandidateItem } from "../../core/model/callsite/callsiteContextSlices";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "taintMockAbility.ts"), [
        "export class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(projectDir, "semanticflow.ets"), [
        "import { UIAbility } from './taintMockAbility';",
        "",
        "export class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
        "export class ParcelBeacon {",
        "  bind(topic: string, cb: (payload: string) => void): void {}",
        "  publish(topic: string, payload: string): void {}",
        "}",
        "",
        "export class HeaderPipe {",
        "  cloneValue(value: string): string {",
        "    return value;",
        "  }",
        "}",
        "",
        "export class InputBox {",
        "  readSecret(): string {",
        "    return 'secret';",
        "  }",
        "}",
        "",
        "export class Cleaner {",
        "  clean(value: string): string {",
        "    return '';",
        "  }",
        "}",
        "",
        "export class Leak {",
        "  report(value: string): void {}",
        "}",
        "",
        "export class Vault {",
        "  put(key: string, value: string): void {}",
        "  get(key: string): string {",
        "    return '';",
        "  }",
        "}",
        "",
        "export function flowOk(box: InputBox, pipe: HeaderPipe, leak: Leak): void {",
        "  const raw = box.readSecret();",
        "  const forwarded = pipe.cloneValue(raw);",
        "  leak.report(forwarded);",
        "}",
        "",
        "export function flowSanitized(box: InputBox, pipe: HeaderPipe, cleaner: Cleaner, leak: Leak): void {",
        "  const raw = box.readSecret();",
        "  const forwarded = pipe.cloneValue(raw);",
        "  const safe = cleaner.clean(forwarded);",
        "  leak.report(safe);",
        "}",
        "",
    ].join("\n"), "utf8");
}

function findMethod(scene: Scene, className: string, methodName: string): ArkMethod {
    for (const method of scene.getMethods()) {
        if (method.getName?.() !== methodName) {
            continue;
        }
        const declaringClass = method.getDeclaringArkClass?.();
        if (declaringClass?.getName?.() === className) {
            return method;
        }
    }
    throw new Error(`missing method ${className}.${methodName}`);
}

function findNamedMethod(scene: Scene, methodName: string): ArkMethod {
    for (const method of scene.getMethods()) {
        if (method.getName?.() === methodName) {
            return method;
        }
    }
    throw new Error(`missing method ${methodName}`);
}

function sinkBelongsTo(flow: { sink: any }, methodName: string): boolean {
    return flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getName?.() === methodName;
}

function extractAnchorId(user: string): string {
    const match = user.match(/^anchorId:\s*(.+)$/m);
    if (!match?.[1]) {
        throw new Error(`anchorId missing from prompt:\n${user}`);
    }
    return match[1].trim();
}

function extractRound(user: string): number {
    const match = user.match(/^round:\s*(\d+)$/m);
    return match?.[1] ? Number(match[1]) : 0;
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tmp/test_runs/runtime/semanticflow/latest/project");
    writeFixture(projectDir);
    const scene = buildScene(projectDir);

    const onCreate = findMethod(scene, "DemoAbility", "onCreate");
    const publish = findMethod(scene, "ParcelBeacon", "publish");
    const cloneValue = findMethod(scene, "HeaderPipe", "cloneValue");
    const readSecret = findMethod(scene, "InputBox", "readSecret");
    const clean = findMethod(scene, "Cleaner", "clean");
    const report = findMethod(scene, "Leak", "report");
    const flowOk = findNamedMethod(scene, "flowOk");
    const flowSanitized = findNamedMethod(scene, "flowSanitized");

    const arkmainCandidates = buildArkMainEntryCandidates(scene);
    const arkmainCandidate = arkmainCandidates
        .find(candidate => candidate.methodSignature === onCreate.getSignature?.().toString?.());
    assert(arkmainCandidate, "expected DemoAbility.onCreate to be discovered as arkmain candidate");
    assert(
        !arkmainCandidates.some(candidate => candidate.className === "UIAbility"),
        "framework base stub UIAbility must not be emitted as an arkmain candidate",
    );

    const ruleCandidateItem = buildSemanticFlowRuleCandidateItem(normalizeNoCandidateItem({
        callee_signature: cloneValue.getSignature?.().toString?.(),
        method: "cloneValue",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "semanticflow.ets",
        count: 2,
        topEntries: ["flowOk", "flowSanitized"],
        contextSlices: [
            {
                callerFile: "semanticflow.ets",
                callerMethod: "flowOk",
                invokeLine: 33,
                invokeStmtText: "const forwarded = pipe.cloneValue(raw);",
                windowLines: "   32 | const raw = box.readSecret();\n   33 | const forwarded = pipe.cloneValue(raw);\n   34 | leak.report(forwarded);",
                cfgNeighborStmts: [
                    "const raw = box.readSecret();",
                    "const forwarded = pipe.cloneValue(raw);",
                    "leak.report(forwarded);",
                ],
            },
        ],
    }));

    const items: SemanticFlowPipelineItemInput[] = [
        buildSemanticFlowArkMainCandidateItem(arkmainCandidate),
        ruleCandidateItem,
        {
            anchor: {
                id: "source.anchor",
                owner: "InputBox",
                surface: "readSecret",
                method: readSecret,
                methodSignature: readSecret.getSignature?.().toString?.(),
            },
            initialSlice: {
                anchorId: "source.anchor",
                round: 0,
                template: "call-return",
                observations: ["readSecret returns framework-controlled data"],
                snippets: [{ label: "method", code: "readSecret(): string { return 'secret'; }" }],
            },
        },
        {
            anchor: {
                id: "sink.anchor",
                owner: "Leak",
                surface: "report",
                method: report,
                methodSignature: report.getSignature?.().toString?.(),
            },
            initialSlice: {
                anchorId: "sink.anchor",
                round: 0,
                template: "call-return",
                observations: ["report(value) is a sensitive output"],
                snippets: [{ label: "method", code: "report(value: string): void {}" }],
            },
        },
        {
            anchor: {
                id: "sanitizer.anchor",
                owner: "Cleaner",
                surface: "clean",
                method: clean,
                methodSignature: clean.getSignature?.().toString?.(),
            },
            initialSlice: {
                anchorId: "sanitizer.anchor",
                round: 0,
                template: "call-return",
                observations: ["clean(value) returns sanitized content"],
                snippets: [{ label: "method", code: "clean(value: string): string { return ''; }" }],
            },
        },
        {
            anchor: {
                id: "module.deferred",
                owner: "ParcelBeacon",
                surface: "publish",
                method: publish,
                methodSignature: publish.getSignature?.().toString?.(),
            },
            initialSlice: {
                anchorId: "module.deferred",
                round: 0,
                template: "callable-transfer",
                observations: ["publish(topic, payload)", "bind(topic, cb)"],
                snippets: [{ label: "anchor", code: "beacon.publish(topic, payload)" }],
            },
        },
        {
            anchor: {
                id: "module.explicit",
                owner: "Vault",
                surface: "put/get",
            },
            initialSlice: {
                anchorId: "module.explicit",
                round: 0,
                template: "multi-surface",
                observations: ["put(key, value)", "get(key)"],
                snippets: [{ label: "anchor", code: "vault.put(key, value) / vault.get(key)" }],
            },
        },
        {
            anchor: {
                id: "hint.mismatch.module",
                owner: "Vault",
                surface: "put",
            },
            initialSlice: {
                anchorId: "hint.mismatch.module",
                round: 0,
                template: "multi-surface",
                observations: ["put(key, value) and get(key) share the same carrier"],
                snippets: [{ label: "anchor", code: "vault.put(key, value)" }],
                companions: ["get"],
            },
        },
        {
            anchor: {
                id: "rule.multi.transfer",
                owner: "MirrorPipe",
                surface: "fanout",
                methodSignature: "@project/semanticflow.ets: MirrorPipe.fanout(string,string)",
            },
            initialSlice: {
                anchorId: "rule.multi.transfer",
                round: 0,
                template: "call-return",
                observations: ["fanout(a, b) returns a and updates receiver with b"],
                snippets: [{ label: "anchor", code: "pipe.fanout(a, b)" }],
            },
        },
        {
            anchor: {
                id: "resolved.no.transfer",
                owner: "Noise",
                surface: "identityLabel",
                methodSignature: "@project/semanticflow.ets: Noise.identityLabel(string)",
            },
            initialSlice: {
                anchorId: "resolved.no.transfer",
                round: 0,
                template: "call-return",
                observations: ["returns a constant label and should not model taint transfer"],
                snippets: [{ label: "anchor", code: "noise.identityLabel(value)" }],
            },
        },
        {
            anchor: {
                id: "reject.anchor",
                owner: "Noise",
                surface: "noop",
            },
            initialSlice: {
                anchorId: "reject.anchor",
                round: 0,
                template: "call-return",
                observations: ["ordinary helper, no propagation"],
                snippets: [{ label: "anchor", code: "noop(value)" }],
            },
        },
        {
            anchor: {
                id: "stalled.anchor",
                owner: "DeferredBus",
                surface: "on",
            },
            initialSlice: {
                anchorId: "stalled.anchor",
                round: 0,
                template: "callable-transfer",
                observations: ["on(topic, cb) but no internal evidence"],
                snippets: [{ label: "anchor", code: "bus.on(topic, cb)" }],
            },
        },
        {
            anchor: {
                id: "broken.response.anchor",
                owner: "Broken",
                surface: "onCreateLike",
            },
            initialSlice: {
                anchorId: "broken.response.anchor",
                round: 0,
                template: "owner-slot",
                observations: ["llm may respond with malformed arkmain entry pattern"],
                snippets: [{ label: "anchor", code: "broken.onCreateLike(want)" }],
            },
        },
    ];

    const decider = createSemanticFlowLlmDecider({
        model: "mock-semanticflow",
        async modelInvoker(input) {
            const anchorId = extractAnchorId(input.user);
            const round = extractRound(input.user);

            if (anchorId === items[0].anchor.id) {
                return JSON.stringify({
                    status: "done",
                    classification: "arkmain",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        relations: {
                            entryPattern: {
                                phase: "bootstrap",
                                kind: "ability_lifecycle",
                                ownerKind: "ability_owner",
                                reason: "framework lifecycle callback",
                                entryFamily: "semanticflow",
                                entryShape: "owner-slot",
                            },
                        },
                    },
                });
            }

            if (anchorId === ruleCandidateItem.anchor.id) {
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
            }

            if (anchorId === "source.anchor") {
                return JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
                        outputs: [{ slot: "result" }],
                        transfers: [],
                        confidence: "high",
                        ruleKind: "source",
                        sourceKind: "call_return",
                    },
                });
            }

            if (anchorId === "sink.anchor") {
                return JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        ruleKind: "sink",
                    },
                });
            }

            if (anchorId === "sanitizer.anchor") {
                return JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
                        outputs: [{ slot: "result" }],
                        transfers: [],
                        confidence: "high",
                        ruleKind: "sanitizer",
                    },
                });
            }

            if (anchorId === "module.deferred") {
                if (round === 0) {
                    return JSON.stringify({
                        status: "need-more-evidence",
                        draft: {
                            inputs: ["publish.arg1"],
                            outputs: ["bind.cb1.param0"],
                            transfers: [],
                            confidence: "medium",
                            moduleKind: "deferred",
                            relations: {
                                companions: ["bind"],
                            },
                        },
                        request: {
                            kind: "q_comp",
                            focus: {
                                from: "publish.arg1",
                                to: "bind.callback1.param0",
                                companion: "bind",
                                triggerHint: "callback_event",
                            },
                            scope: {
                                owner: "ParcelBeacon",
                                locality: "owner",
                                surface: "publish",
                                sharedSymbols: ["topic"],
                            },
                            budgetClass: "owner_local",
                            why: ["need companion callback registration evidence"],
                            ask: "show bind(topic, cb) and topic matching evidence",
                        },
                    });
                }
                return JSON.stringify({
                    status: "done",
                    classification: "module",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ surface: "publish", slot: "arg", index: 1 }],
                        outputs: [{ surface: "bind", slot: "callback_param", callbackArgIndex: 1, paramIndex: 0 }],
                        transfers: [{
                            from: { surface: "publish", slot: "arg", index: 1 },
                            to: { surface: "bind", slot: "callback_param", callbackArgIndex: 1, paramIndex: 0 },
                            relation: "deferred",
                            companionSurface: "bind",
                        }],
                        confidence: "high",
                        moduleKind: "deferred",
                        relations: {
                            companions: ["bind"],
                            trigger: {
                                preset: "callback_event",
                                reason: "publish dispatches payload to registered callback",
                            },
                            constraints: [
                                { kind: "same_receiver" },
                                {
                                    kind: "same_address",
                                    left: {
                                        kind: "endpoint",
                                        endpoint: { surface: "publish", slot: "arg", index: 0 },
                                    },
                                    right: {
                                        kind: "endpoint",
                                        endpoint: { surface: "bind", slot: "arg", index: 0 },
                                    },
                                },
                            ],
                        },
                    },
                });
            }

            if (anchorId === "module.explicit") {
                return JSON.stringify({
                    status: "done",
                    classification: "module",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        moduleSpec: {
                            kind: "keyed_storage",
                            storageClasses: ["Vault"],
                            writeMethods: [{ methodName: "put", valueIndex: 1 }],
                            readMethods: ["get"],
                        },
                    },
                });
            }

            if (anchorId === "hint.mismatch.module") {
                return JSON.stringify({
                    status: "done",
                    classification: "module",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        moduleSpec: {
                            id: "vault.storage.hinted",
                            semantics: [
                                {
                                    kind: "keyed_storage",
                                    storageClasses: ["Vault"],
                                    writeMethods: [{ methodName: "put", valueIndex: 1 }],
                                    readMethods: ["get"],
                                },
                            ],
                        },
                    },
                });
            }

            if (anchorId === "rule.multi.transfer") {
                return JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: ["arg0", "arg1"],
                        outputs: ["ret", "base"],
                        transfers: [
                            "arg0 -> ret",
                            "arg1 -> base",
                        ],
                        confidence: "high",
                        ruleKind: "transfer",
                    },
                });
            }

            if (anchorId === "resolved.no.transfer") {
                return JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "no-transfer",
                    summary: {
                        inputs: [],
                        outputs: ["ret"],
                        transfers: [],
                        confidence: "high",
                        ruleKind: "source",
                        sourceKind: "call_return",
                    },
                });
            }

            if (anchorId === "reject.anchor") {
                return JSON.stringify({
                    status: "reject",
                    reason: "ordinary helper with no transfer semantics",
                });
            }

            if (anchorId === "broken.response.anchor") {
                return JSON.stringify({
                    status: "done",
                    classification: "arkmain",
                    resolution: "resolved",
                    summary: {
                        inputs: ["arg0"],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        relations: {
                            entryPattern: "page_lifecycle",
                        },
                    },
                });
            }

            return JSON.stringify({
                status: "need-more-evidence",
                draft: {
                    inputs: [],
                    outputs: ["callback0.param0"],
                    transfers: [],
                    confidence: "low",
                    moduleKind: "deferred",
                    relations: {
                        companions: ["emit"],
                    },
                },
                request: {
                    kind: "q_cb",
                    focus: {
                        from: "emit.arg1",
                        to: "callback0.param0",
                        companion: "emit",
                        triggerHint: "callback_event",
                    },
                    scope: {
                        owner: "DeferredBus",
                        locality: "owner",
                        surface: "on",
                        sharedSymbols: ["topic"],
                    },
                    budgetClass: "owner_local",
                    why: ["still missing callback connection evidence"],
                    ask: "show internal callback storage and dispatch",
                },
            });
        },
    });

    const expander: SemanticFlowExpander = {
        async expand(input) {
            if (input.anchor.id === "module.deferred") {
                return {
                    slice: {
                        ...input.slice,
                        round: input.round + 1,
                        observations: [...input.slice.observations, "bind(topic, cb) companion discovered"],
                        snippets: [
                            ...input.slice.snippets,
                            { label: "companion", code: "beacon.bind(topic, cb)" },
                        ],
                        notes: [...(input.slice.notes || []), input.deficit.ask],
                        companions: ["bind"],
                    },
                    delta: {
                        id: "delta.module.deferred.r1",
                        newObservations: ["bind(topic, cb) companion discovered"],
                        newSnippets: [{ label: "companion", code: "beacon.bind(topic, cb)" }],
                        newCompanions: ["bind"],
                        effective: true,
                    },
                };
            }
            return {
                slice: input.slice,
                delta: {
                    id: `delta.${input.anchor.id}.noop`,
                    newObservations: [],
                    newSnippets: [],
                    newCompanions: [],
                    effective: false,
                },
            };
        },
    };

    const preview = await runSemanticFlowPipeline(items, decider, expander, { maxRounds: 2 });
    assert(preview.items.length === 13, `expected 13 preview items, got ${preview.items.length}`);

    const session = await runSemanticFlowSession(items, decider, expander, { maxRounds: 2 });
    assert(session.run.items.length === 13, `expected 13 session items, got ${session.run.items.length}`);

    const byId = new Map(session.run.items.map(item => [item.anchor.id, item]));
    assert(byId.get(items[0].anchor.id)?.classification === "arkmain", "arkmain item should classify as arkmain");
    assert(byId.get(ruleCandidateItem.anchor.id)?.classification === "rule", "transfer item should classify as rule");
    assert(byId.get("source.anchor")?.classification === "rule", "source item should classify as rule");
    assert(byId.get("sink.anchor")?.classification === "rule", "sink item should classify as rule");
    assert(byId.get("sanitizer.anchor")?.classification === "rule", "sanitizer item should classify as rule");
    assert(byId.get("module.deferred")?.classification === "module", "deferred item should classify as module");
    assert(byId.get("module.explicit")?.classification === "module", "explicit item should classify as module");
    assert(byId.get("hint.mismatch.module")?.classification === "module", "structural module summary should override mismatched rule hint");
    assert(byId.get("rule.multi.transfer")?.classification === "rule", "multi transfer item should classify as rule");
    assert(byId.get("resolved.no.transfer")?.classification === undefined, "non-resolved summary should not keep a final classification");
    assert(byId.get("resolved.no.transfer")?.artifact === undefined, "non-resolved summary should not emit an artifact");
    assert(byId.get("resolved.no.transfer")?.resolution === "no-transfer", "done/no-transfer should preserve no-transfer resolution");
    assert(byId.get("reject.anchor")?.resolution === "rejected", "reject item should be rejected");
    assert(byId.get("stalled.anchor")?.resolution === "unresolved", "stalled item should become unresolved");
    assert(byId.get("broken.response.anchor")?.resolution === "need-human-check", "malformed llm response should degrade to need-human-check");
    assert(String(byId.get("broken.response.anchor")?.error || "").includes("semanticflow llm response invalid"), "malformed llm response should preserve parse error");
    assert((byId.get("broken.response.anchor")?.history.length || 0) === 1, "malformed llm response should preserve the failed round slice");
    assert(!byId.get("broken.response.anchor")?.history[0]?.decision, "malformed llm response should not fabricate a decision");
    assert(String(byId.get("broken.response.anchor")?.history[0]?.error || "").includes("semanticflow llm response invalid"), "malformed llm response should preserve round error");
    assert((byId.get("module.deferred")?.history.length || 0) === 2, "deferred item should require one expansion");
    assert(byId.get("module.deferred")?.draftId === "draft.module.deferred", "module item should keep stable draft id");
    assert(byId.get("module.deferred")?.history[0]?.deficit?.kind === "q_comp", "round0 should materialize structured deficit");
    assert(Boolean(byId.get("module.deferred")?.history[0]?.plan), "round0 should record expand plan");
    assert(Boolean(byId.get("module.deferred")?.history[0]?.delta?.effective), "round0 should record effective evidence delta");
    assert(Boolean(byId.get("module.deferred")?.history[0]?.marker?.deficitId), "round0 should record marker");
    assert(byId.get("stalled.anchor")?.history[0]?.deficit?.kind === "q_cb", "stalled anchor should preserve q_cb deficit");
    assert(byId.get("stalled.anchor")?.draftId === "draft.stalled.anchor", "stalled anchor should keep stable draft id");

    assert(session.augment.arkMainSpecs.length === 1, `expected 1 arkMainSpec, got ${session.augment.arkMainSpecs.length}`);
    assert(session.augment.moduleSpecs.length === 2, `expected 2 footprint-distinct module specs, got ${session.augment.moduleSpecs.length}`);
    assert(
        session.augment.moduleSpecs.filter(spec => spec.semantics.some(semantic => semantic.kind === "keyed_storage")).length === 1,
        "footprint consolidation should dedupe duplicate keyed_storage module specs",
    );
    assert(session.augment.ruleSet.sources.length === 1, `expected 1 source rule, got ${session.augment.ruleSet.sources.length}`);
    assert(session.augment.ruleSet.sinks.length === 1, `expected 1 sink rule, got ${session.augment.ruleSet.sinks.length}`);
    assert((session.augment.ruleSet.sanitizers || []).length === 1, `expected 1 sanitizer rule, got ${(session.augment.ruleSet.sanitizers || []).length}`);
    assert(session.augment.ruleSet.transfers.length === 3, `expected 3 transfer rules, got ${session.augment.ruleSet.transfers.length}`);

    assert(session.engineAugment.sourceRules.length === 1, "engine augment should expose source rules");
    assert(session.engineAugment.sinkRules.length === 1, "engine augment should expose sink rules");
    assert(session.engineAugment.sanitizerRules.length === 1, "engine augment should expose sanitizer rules");
    assert(session.engineAugment.transferRules.length === 3, "engine augment should expose transfer rules");
    assert(session.engineAugment.arkMainSpecs.length === 1, "engine augment should expose arkmain specs");
    assert(session.engineAugment.moduleSpecs.length === 2, "engine augment should expose deduped module specs");

    for (const spec of session.augment.moduleSpecs) {
        compileModuleSpec(spec);
    }

    const arkmainAnalysis = await runSemanticFlowAnalysis(scene, session, {
        buildPAG: { entryModel: "arkMain" },
    });

    const moduleAudit = arkmainAnalysis.engine.getModuleAuditSnapshot();
    for (const spec of session.augment.moduleSpecs) {
        assert(
            moduleAudit.loadedModuleIds.some(id => id === spec.id || id.startsWith(`${spec.id}::`)),
            `generated module spec should be loaded: ${spec.id}`,
        );
    }

    const arkMainSeedReport = arkmainAnalysis.engine.getArkMainSeedReport();
    assert(arkMainSeedReport?.factCount === 1, `expected factCount=1, got ${arkMainSeedReport?.factCount}`);

    const flowAnalysis = await runSemanticFlowAnalysis(scene, session, {
        buildPAG: {
            entryModel: "explicit",
            syntheticEntryMethods: [flowOk, flowSanitized],
        },
    });
    assert(flowAnalysis.seedInfo.seedCount > 0, `expected source seeding, got ${flowAnalysis.seedInfo.seedCount}`);
    assert(flowAnalysis.flows.length === 1, `expected only one unsanitized sink flow, got ${flowAnalysis.flows.length}`);
    assert(sinkBelongsTo(flowAnalysis.flows[0], "flowOk"), "remaining sink flow should belong to flowOk");
    assert(!flowAnalysis.flows.some(flow => sinkBelongsTo(flow, "flowSanitized")), "sanitized flow should be suppressed");

    console.log("PASS testSemanticFlowPipeline");
}

main().catch(error => {
    console.error("FAIL testSemanticFlowPipeline");
    console.error(error);
    process.exit(1);
});
