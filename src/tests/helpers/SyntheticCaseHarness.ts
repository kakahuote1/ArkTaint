import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintPropagationEngine, TaintEngineOptions } from "../../core/orchestration/TaintPropagationEngine";

export interface ResolvedCaseMethod {
    name: string;
    pathHint?: string;
}

export interface ResolveCaseMethodOptions {
    explicitEntry?: ResolvedCaseMethod;
}

export function getParameterLocalNames(entryMethod: ArkMethod): Set<string> {
    const names = new Set<string>();
    const cfg = entryMethod.getCfg();
    if (!cfg) return names;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) {
            names.add(leftOp.getName());
        }
    }
    return names;
}

export function resolveCaseMethod(
    scene: Scene,
    relativePath: string,
    testName: string,
    options?: ResolveCaseMethodOptions,
): ResolvedCaseMethod {
    if (options?.explicitEntry?.name) {
        return options.explicitEntry;
    }
    const normalized = relativePath.replace(/\\/g, "/");
    const isCrossFileA = testName.startsWith("cross_file_")
        && testName.endsWith("_a")
        && (
            normalized.includes("completeness/cross_file/")
            || normalized === `${testName}.ets`
        );
    if (isCrossFileA) {
        const companion = `${testName.slice(0, -2)}_b`;
        const hasCompanion = scene.getMethods().some(m => m.getName() === companion);
        if (hasCompanion) {
            const companionHint = normalized.replace(/_a\.ets$/i, "_b.ets");
            return { name: companion, pathHint: companionHint };
        }
    }

    const hasSameName = scene.getMethods().some(m => m.getName() === testName);
    if (hasSameName) {
        return { name: testName, pathHint: normalized };
    }

    const methodsInFile = scene
        .getMethods()
        .filter(m => m.getSignature().toString().includes(normalized) && m.getName() !== "%dflt");
    const labeled = methodsInFile.filter(m => /_(T|F)(?:_[ab])?$/.test(m.getName()));

    if (labeled.length === 1) {
        return { name: labeled[0].getName(), pathHint: normalized };
    }

    const expectedLabel = testName.includes("_T") ? "_T" : testName.includes("_F") ? "_F" : "";
    if (expectedLabel) {
        const labelMatch = labeled.find(m => m.getName().includes(expectedLabel));
        if (labelMatch) {
            return { name: labelMatch.getName(), pathHint: normalized };
        }
    }

    if (methodsInFile.length > 0) {
        return { name: methodsInFile[0].getName(), pathHint: normalized };
    }

    return { name: testName, pathHint: normalized };
}

export function findCaseMethod(scene: Scene, entry: ResolvedCaseMethod): ArkMethod | undefined {
    const candidates = scene.getMethods().filter(m => m.getName() === entry.name);
    if (entry.pathHint) {
        const hinted = candidates.find(m => m.getSignature().toString().includes(entry.pathHint!));
        if (hinted) return hinted;
    }
    return candidates[0];
}

export async function buildEngineForCase(
    scene: Scene,
    k: number,
    entryMethod: ArkMethod,
    options?: {
        engineOptions?: TaintEngineOptions;
        verbose?: boolean;
        syntheticEntryMethods?: ArkMethod[];
        entryModel?: "arkMain" | "explicit";
    }
): Promise<TaintPropagationEngine> {
    const requestedOptions = options?.engineOptions || {};
    const engine = new TaintPropagationEngine(scene, k, requestedOptions);
    engine.verbose = options?.verbose ?? false;
    await engine.buildPAG({
        syntheticEntryMethods: options?.syntheticEntryMethods || [entryMethod],
        entryModel: options?.entryModel,
    });
    return engine;
}

export function collectCaseSeedNodes(
    engine: TaintPropagationEngine,
    entryMethod: ArkMethod,
    options?: {
        sourceLocalNames?: string[];
        includeParameterLocals?: boolean;
    }
): any[] {
    const methodBody = entryMethod.getBody();
    if (!methodBody) return [];

    const sourceLocalNames = new Set(options?.sourceLocalNames || ["taint_src"]);
    const includeParameterLocals = options?.includeParameterLocals !== false;
    const parameterLocals = includeParameterLocals ? getParameterLocalNames(entryMethod) : new Set<string>();
    const seeds: any[] = [];
    const seenNodeIds = new Set<number>();

    for (const local of methodBody.getLocals().values()) {
        const shouldSeed = sourceLocalNames.has(local.getName()) || parameterLocals.has(local.getName());
        if (!shouldSeed) continue;
        const nodes = engine.pag.getNodesByValue(local);
        if (!nodes) continue;
        for (const nodeId of nodes.values()) {
            const numericNodeId = Number(nodeId);
            if (seenNodeIds.has(numericNodeId)) continue;
            seenNodeIds.add(numericNodeId);
            seeds.push(engine.pag.getNode(nodeId));
        }
    }

    return seeds;
}

