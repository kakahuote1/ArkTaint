import * as fs from "fs";
import * as path from "path";
import { buildInferenceScene } from "./helpers/ExecutionHandoffInferenceSupport";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "./helpers/ExecutionHandoffContractSupport";
import {
    activeExecutionHandoffCompareCases,
    executionHandoffCompareManifestPath,
    executionHandoffCompareOutputTag,
    loadExecutionHandoffCompareManifest,
    type ExecutionHandoffCompareManifest,
    type ExecutionHandoffCompareCase,
} from "./helpers/ExecutionHandoffCompareManifest";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "./helpers/SyntheticCaseHarness";
import type {
    MainlineDeferredHandoffMode,
    ResearchDeferredHandoffMode,
} from "../core/orchestration/ExecutionHandoffModes";
import { loadRuleSet } from "../core/rules/RuleLoader";
import type { SanitizerRule, SinkRule, SourceRule } from "../core/rules/RuleSchema";

type CompareMode = "paper_like" | "contract_active";

interface ModeCaseResult {
    mode: CompareMode;
    detected: boolean;
    flowCount: number;
    seedCount: number;
    pass: boolean;
    deferredContracts: number;
    activationCounts: Record<string, number>;
    envCounts: Record<string, number>;
    completionCounts: Record<string, number>;
    preserveCounts: Record<string, number>;
    edgeCount: number;
    unitEdgeHit: boolean;
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const value of values) {
        const key = keyFn(value);
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

interface CaseCompareResult {
    caseName: string;
    expected: boolean;
    layer: string;
    twinGroup: string;
    semanticFamily: string;
    variantId: string;
    note: string;
    factors: ExecutionHandoffCompareCase["factors"];
    results: Record<CompareMode, ModeCaseResult>;
}

interface ModeSummary {
    mode: CompareMode;
    totalCases: number;
    passCases: number;
    failCases: number;
    truePositives: number;
    trueNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    improvedOverPaperLike: string[];
    regressedVsPaperLike: string[];
    inferredDeferredOverPaperLike: string[];
    explicitUnitEdgeOverPaperLike: string[];
}

interface FamilyModeSummary {
    mode: CompareMode;
    semanticFamily: string;
    variants: string[];
    totalCases: number;
    passCases: number;
    positiveCases: number;
    positivePassCases: number;
    negativeCases: number;
    negativePassCases: number;
    deferredCases: number;
    deferredContractCases: number;
    explicitUnitEdgeCases: number;
    fullPass: boolean;
    polarityStable: boolean;
}

const MODES: CompareMode[] = ["paper_like", "contract_active"];

function buildEngineOptionsForCompareMode(mode: CompareMode): {
    deferredHandoffMode?: MainlineDeferredHandoffMode;
    researchDeferredHandoffMode?: ResearchDeferredHandoffMode;
} {
    if (mode === "contract_active") {
        return { deferredHandoffMode: mode as MainlineDeferredHandoffMode };
    }
    return { researchDeferredHandoffMode: mode as ResearchDeferredHandoffMode };
}

interface LoadedCompareRuleSet {
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
    sanitizerRules: SanitizerRule[];
}

function readStringFlag(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index >= 0 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }
    return undefined;
}

async function runCaseInMode(
    manifest: ExecutionHandoffCompareManifest,
    sourceDir: string,
    spec: ExecutionHandoffCompareCase,
    mode: CompareMode,
    caseViewRoot: string,
    loadedRuleSet?: LoadedCompareRuleSet,
): Promise<ModeCaseResult> {
    const projectDir = createIsolatedCaseView(path.resolve(sourceDir), spec.caseName, path.join(caseViewRoot, mode));
    const scene = buildInferenceScene(projectDir);
    const relativePath = `${spec.caseName}.ets`;
    const entry = resolveCaseMethod(scene, relativePath, spec.caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `failed to resolve entry method for ${spec.caseName}`);
    const runtime = manifest.runtime || {};
    const seedMode = runtime.seedMode || "manual_local_seed";

    const engine = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        engineOptions: {
            ...buildEngineOptionsForCompareMode(mode),
            includeBuiltinSemanticPacks: runtime.includeBuiltinSemanticPacks === true,
            includeBuiltinEnginePlugins: runtime.includeBuiltinEnginePlugins === true,
        },
    });
    let seedCount = 0;
    let flows: any[] = [];
    if (seedMode === "source_rules") {
        assert(!!loadedRuleSet, `expected source rules for compare case ${spec.caseName}`);
        try {
            const reachable = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachable);
        } catch {
            engine.setActiveReachableMethodSignatures(undefined);
        }
        const seedInfo = engine.propagateWithSourceRules(loadedRuleSet!.sourceRules);
        seedCount = seedInfo.seedCount;
        flows = engine.detectSinksByRules(loadedRuleSet!.sinkRules, {
            sanitizerRules: loadedRuleSet!.sanitizerRules,
        });
    } else {
        const seeds = collectCaseSeedNodes(engine, entryMethod!, {
            sourceLocalNames: ["taint_src"],
            includeParameterLocals: false,
        });
        assert(seeds.length > 0, `expected taint_src seed in ${spec.caseName}`);
        seedCount = seeds.length;
        engine.propagateWithSeeds(seeds);
        flows = engine.detectSinks("Sink");
    }
    const detected = flows.length > 0;
    const snapshot = engine.getExecutionHandoffContractSnapshot();
    const edgeSnapshot = engine.getSyntheticInvokeEdgeSnapshot();
    const contracts = snapshot?.contracts || [];
    const deferredContracts = contracts.filter(contract => contract.kernel.domain === "deferred").length;

    return {
        mode,
        detected,
        flowCount: flows.length,
        seedCount,
        pass: detected === spec.expected,
        deferredContracts,
        activationCounts: countBy(contracts, contract => contract.kernel.activation),
        envCounts: countBy(contracts, contract => contract.ports.env),
        completionCounts: countBy(contracts, contract => contract.ports.completion),
        preserveCounts: countBy(contracts, contract => contract.ports.preserve),
        edgeCount: edgeSnapshot.totalEdges,
        unitEdgeHit: edgeSnapshot.calleeSignatures.some(sig => sig.includes(spec.caseName.replace(/_(T|F)$/, ""))),
    };
}

function loadCompareRuleSet(manifest: ExecutionHandoffCompareManifest): LoadedCompareRuleSet | undefined {
    const runtime = manifest.runtime || {};
    if ((runtime.seedMode || "manual_local_seed") !== "source_rules") {
        return undefined;
    }
    assert(!!runtime.defaultRulePath, "source_rules compare manifest requires runtime.defaultRulePath");
    assert(!!runtime.projectRulePath, "source_rules compare manifest requires runtime.projectRulePath");
    const loaded = loadRuleSet({
        defaultRulePath: path.resolve(runtime.defaultRulePath!),
        projectRulePath: path.resolve(runtime.projectRulePath!),
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });
    return {
        sourceRules: loaded.ruleSet.sources || [],
        sinkRules: loaded.ruleSet.sinks || [],
        sanitizerRules: loaded.ruleSet.sanitizers || [],
    };
}

function summarizeMode(mode: CompareMode, results: CaseCompareResult[]): ModeSummary {
    let passCases = 0;
    let truePositives = 0;
    let trueNegatives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    const improvedOverPaperLike: string[] = [];
    const regressedVsPaperLike: string[] = [];
    const inferredDeferredOverPaperLike: string[] = [];
    const explicitUnitEdgeOverPaperLike: string[] = [];

    for (const item of results) {
        const current = item.results[mode];
        const paperLike = item.results.paper_like;
        if (current.pass) {
            passCases += 1;
        }
        if (item.expected && current.detected) truePositives += 1;
        if (!item.expected && !current.detected) trueNegatives += 1;
        if (!item.expected && current.detected) falsePositives += 1;
        if (item.expected && !current.detected) falseNegatives += 1;

        if (mode !== "paper_like") {
            if (!paperLike.pass && current.pass) {
                improvedOverPaperLike.push(item.caseName);
            }
            if (paperLike.pass && !current.pass) {
                regressedVsPaperLike.push(item.caseName);
            }
            if (paperLike.deferredContracts === 0 && current.deferredContracts > 0) {
                inferredDeferredOverPaperLike.push(item.caseName);
            }
            if (!paperLike.unitEdgeHit && current.unitEdgeHit) {
                explicitUnitEdgeOverPaperLike.push(item.caseName);
            }
        }
    }

    return {
        mode,
        totalCases: results.length,
        passCases,
        failCases: results.length - passCases,
        truePositives,
        trueNegatives,
        falsePositives,
        falseNegatives,
        improvedOverPaperLike,
        regressedVsPaperLike,
        inferredDeferredOverPaperLike,
        explicitUnitEdgeOverPaperLike,
    };
}

function buildFamilySummaries(results: CaseCompareResult[]): FamilyModeSummary[] {
    const families = new Map<string, CaseCompareResult[]>();
    for (const item of results) {
        if (!families.has(item.semanticFamily)) {
            families.set(item.semanticFamily, []);
        }
        families.get(item.semanticFamily)!.push(item);
    }

    const summaries: FamilyModeSummary[] = [];
    for (const [semanticFamily, items] of families.entries()) {
        for (const mode of MODES) {
            let passCases = 0;
            let positiveCases = 0;
            let positivePassCases = 0;
            let negativeCases = 0;
            let negativePassCases = 0;
            let deferredCases = 0;
            let deferredContractCases = 0;
            let explicitUnitEdgeCases = 0;
            const variants = [...new Set(items.map(item => item.variantId))].sort((a, b) => a.localeCompare(b));

            for (const item of items) {
                const result = item.results[mode];
                if (result.pass) {
                    passCases += 1;
                }
                if (item.expected) {
                    positiveCases += 1;
                    if (result.pass) {
                        positivePassCases += 1;
                    }
                } else {
                    negativeCases += 1;
                    if (result.pass) {
                        negativePassCases += 1;
                    }
                }
                if (item.factors.deferred) {
                    deferredCases += 1;
                    if (result.deferredContracts > 0) {
                        deferredContractCases += 1;
                    }
                    if (result.unitEdgeHit) {
                        explicitUnitEdgeCases += 1;
                    }
                }
            }

            summaries.push({
                mode,
                semanticFamily,
                variants,
                totalCases: items.length,
                passCases,
                positiveCases,
                positivePassCases,
                negativeCases,
                negativePassCases,
                deferredCases,
                deferredContractCases,
                explicitUnitEdgeCases,
                fullPass: passCases === items.length,
                polarityStable: positivePassCases === positiveCases && negativePassCases === negativeCases,
            });
        }
    }

    return summaries.sort((a, b) => {
        const familyCmp = a.semanticFamily.localeCompare(b.semanticFamily);
        if (familyCmp !== 0) {
            return familyCmp;
        }
        return a.mode.localeCompare(b.mode);
    });
}

function renderMarkdown(results: CaseCompareResult[], summaries: ModeSummary[], familySummaries: FamilyModeSummary[]): string {
    const lines: string[] = [];
    lines.push("# Execution Handoff Compare");
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    for (const summary of summaries) {
        lines.push(
            `- \`${summary.mode}\`: pass=${summary.passCases}/${summary.totalCases}, `
            + `tp=${summary.truePositives}, tn=${summary.trueNegatives}, `
            + `fp=${summary.falsePositives}, fn=${summary.falseNegatives}, `
            + `betterThanPaperLike=${summary.improvedOverPaperLike.length}, worseThanPaperLike=${summary.regressedVsPaperLike.length}, `
            + `inferredDeferred=${summary.inferredDeferredOverPaperLike.length}, `
            + `explicitUnitEdge=${summary.explicitUnitEdgeOverPaperLike.length}`,
        );
    }
    lines.push("");
    if (familySummaries.length > 0) {
        lines.push("## Semantic Families");
        lines.push("");
        for (const family of familySummaries) {
            lines.push(
                `- \`${family.semanticFamily}\` / \`${family.mode}\`: `
                + `pass=${family.passCases}/${family.totalCases}, `
                + `positive=${family.positivePassCases}/${family.positiveCases}, `
                + `negative=${family.negativePassCases}/${family.negativeCases}, `
                + `deferredContracts=${family.deferredContractCases}/${family.deferredCases}, `
                + `explicitUnitEdges=${family.explicitUnitEdgeCases}/${family.deferredCases}, `
                + `fullPass=${family.fullPass}, polarityStable=${family.polarityStable}, `
                + `variants=${family.variants.join(", ")}`,
            );
        }
        lines.push("");
    }
    lines.push("## Cases");
    lines.push("");
    for (const item of results) {
        lines.push(`### ${item.caseName}`);
        lines.push(
            `- expected=${item.expected ? "T" : "F"}, layer=${item.layer}, twinGroup=${item.twinGroup}, `
            + `semanticFamily=${item.semanticFamily}, variantId=${item.variantId}, note=${item.note}`,
        );
        lines.push(`- factors=${JSON.stringify(item.factors)}`);
        for (const mode of MODES) {
            const result = item.results[mode];
            lines.push(
                `- ${mode}: detected=${result.detected}, flowCount=${result.flowCount}, `
                + `deferred=${result.deferredContracts}, activation=${JSON.stringify(result.activationCounts)}, `
                + `env=${JSON.stringify(result.envCounts)}, completion=${JSON.stringify(result.completionCounts)}, `
                + `preserve=${JSON.stringify(result.preserveCounts)}, `
                + `edgeCount=${result.edgeCount}, pass=${result.pass}`,
            );
        }
        lines.push("");
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const manifestPath = readStringFlag("--manifest") || executionHandoffCompareManifestPath();
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const sourceDir = manifest.sourceDir;
    const loadedRuleSet = loadCompareRuleSet(manifest);
    const outputTag = executionHandoffCompareOutputTag(manifest);
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_compare", outputTag, "latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(caseViewRoot);
    const cases = activeExecutionHandoffCompareCases(manifest);

    const results: CaseCompareResult[] = [];
    for (const spec of cases) {
        const caseResults = {} as Record<CompareMode, ModeCaseResult>;
        for (const mode of MODES) {
            caseResults[mode] = await runCaseInMode(manifest, sourceDir, spec, mode, caseViewRoot, loadedRuleSet);
        }
        results.push({
            caseName: spec.caseName,
            expected: spec.expected,
            layer: spec.layer,
            twinGroup: spec.twinGroup,
            semanticFamily: spec.semanticFamily || spec.twinGroup,
            variantId: spec.variantId || spec.caseName,
            note: spec.note,
            factors: spec.factors,
            results: caseResults,
        });
    }

    const summaries = MODES.map(mode => summarizeMode(mode, results));
    const familySummaries = buildFamilySummaries(results);
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_compare.json"),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                sourceDir: path.resolve(sourceDir),
                manifestPath: path.resolve(manifestPath),
                manifestScope: manifest.activeCompareScope.name,
                modes: MODES,
                summaries,
                familySummaries,
                results,
            },
            null,
            2,
        ),
        "utf8",
    );
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_compare.md"),
        renderMarkdown(results, summaries, familySummaries),
        "utf8",
    );

    console.log("execution_handoff_compare=PASS");
    for (const summary of summaries) {
        console.log(
            `${summary.mode}: pass=${summary.passCases}/${summary.totalCases} `
            + `tp=${summary.truePositives} tn=${summary.trueNegatives} `
            + `fp=${summary.falsePositives} fn=${summary.falseNegatives} `
            + `betterThanPaperLike=${summary.improvedOverPaperLike.length} worseThanPaperLike=${summary.regressedVsPaperLike.length} `
            + `inferredDeferred=${summary.inferredDeferredOverPaperLike.length} `
            + `explicitUnitEdge=${summary.explicitUnitEdgeOverPaperLike.length}`,
        );
    }
}

main().catch(err => {
    console.error("execution_handoff_compare=FAIL");
    console.error(err);
    process.exitCode = 1;
});
