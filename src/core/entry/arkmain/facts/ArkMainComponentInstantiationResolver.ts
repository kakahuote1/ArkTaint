import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkNewExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { resolveCalleeCandidates } from "../../../substrate/queries/CalleeResolver";
import { hasArkMainOfficialComponentDeclarationForMethod } from "../catalog/ArkMainOfficialDeclarationCatalog";

interface ComponentClassRecord {
    className: string;
    classSignature: string;
    cls: any;
    entrypointMethods: ArkMethod[];
}

interface ComponentClassRecordIndex {
    records: ComponentClassRecord[];
    byClassSignature: Map<string, ComponentClassRecord>;
}

export interface ComponentEntrypointExpansionIndexOptions {
    methods?: Iterable<ArkMethod>;
    progress?: (msg: string) => void;
    progressInterval?: number;
}

const fullComponentEntrypointExpansionIndexCache = new WeakMap<Scene, Map<string, string[]>>();
const componentClassRecordIndexCache = new WeakMap<Scene, ComponentClassRecordIndex>();
const componentTargetsByMethodSignatureCache = new WeakMap<Scene, Map<string, string[]>>();

export function expandReachableComponentEntrypoints(
    scene: Scene,
    reachableMethodSignatures: ReadonlySet<string>,
): ArkMethod[] {
    const index = buildComponentEntrypointExpansionIndex(scene);
    if (index.size === 0) return [];

    const methodsBySig = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        const sig = method.getSignature?.()?.toString?.();
        if (sig) methodsBySig.set(sig, method);
    }

    const out = new Map<string, ArkMethod>();
    for (const reachableSig of reachableMethodSignatures) {
        for (const targetSig of index.get(reachableSig) || []) {
            const target = methodsBySig.get(targetSig);
            if (!target) continue;
            out.set(targetSig, target);
        }
    }

    return [...out.values()];
}

export function buildComponentEntrypointExpansionIndex(
    scene: Scene,
    options: ComponentEntrypointExpansionIndexOptions = {},
): Map<string, string[]> {
    const progress = options.progress;
    const progressInterval = options.progressInterval ?? 200;
    if (!options.methods) {
        const cached = fullComponentEntrypointExpansionIndexCache.get(scene);
        if (cached) {
            progress?.(`[component-entrypoint-index] reused full index indexed=${cached.size}`);
            return cached;
        }
    } else {
        const cachedFull = fullComponentEntrypointExpansionIndexCache.get(scene);
        if (cachedFull) {
            const methods = [...options.methods];
            const filtered = new Map<string, string[]>();
            for (const method of methods) {
                const methodSig = method.getSignature?.()?.toString?.();
                const targets = methodSig ? cachedFull.get(methodSig) : undefined;
                if (methodSig && targets && targets.length > 0) {
                    filtered.set(methodSig, targets);
                }
            }
            progress?.(`[component-entrypoint-index] reused full index scanned=${methods.length} indexed=${filtered.size}`);
            return filtered;
        }
    }
    const { records: componentRecords, byClassSignature } = getComponentClassRecordIndex(scene);
    const index = new Map<string, string[]>();
    if (componentRecords.length === 0) return index;
    progress?.(`[component-entrypoint-index] component records=${componentRecords.length}`);

    const addTarget = (targets: Set<string>, method: ArkMethod): void => {
        const sig = method.getSignature?.()?.toString?.();
        if (sig) targets.add(sig);
    };
    const addComponentEntrypoints = (targets: Set<string>, record: ComponentClassRecord): void => {
        for (const entrypoint of record.entrypointMethods) addTarget(targets, entrypoint);
    };

    const methods = options.methods ? [...options.methods] : scene.getMethods();
    const perMethodCache = getComponentTargetsByMethodSignatureCache(scene);
    let scannedMethods = 0;
    for (const method of methods) {
        scannedMethods++;
        if (scannedMethods === 1 || scannedMethods % progressInterval === 0) {
            progress?.(`[component-entrypoint-index] scanning method #${scannedMethods}/${methods.length} current=${method.getName?.() || "<unknown>"}`);
        }
        const methodSig = method.getSignature?.()?.toString?.();
        if (!methodSig) continue;
        const cachedTargets = perMethodCache.get(methodSig);
        if (cachedTargets) {
            if (cachedTargets.length > 0) index.set(methodSig, cachedTargets);
            continue;
        }
        const targets = new Set<string>();

        const ownerRecord = byClassSignature.get(method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "");
        if (ownerRecord && isComponentConstructionMethod(method)) {
            addComponentEntrypoints(targets, ownerRecord);
        }
        if (ownerRecord && isComponentEntrypointMethod(method)) {
            addComponentEntrypoints(targets, ownerRecord);
        }

        for (const stmt of collectMethodAndDeclaringInitializerStmts(method)) {
            for (const target of resolveInstantiatedComponentRecords(scene, stmt, byClassSignature)) {
                addComponentEntrypoints(targets, target);
            }
        }

        const targetList = [...targets];
        perMethodCache.set(methodSig, targetList);
        if (targetList.length > 0) index.set(methodSig, targetList);
    }
    progress?.(`[component-entrypoint-index] done scanned=${scannedMethods} indexed=${index.size}`);

    if (!options.methods) {
        fullComponentEntrypointExpansionIndexCache.set(scene, index);
    }
    return index;
}

function collectComponentClassRecords(scene: Scene): ComponentClassRecord[] {
    const records: ComponentClassRecord[] = [];
    for (const cls of scene.getClasses()) {
        if (!isArkUiComponentClass(cls)) continue;
        const className = String(cls.getName?.() || "");
        const classSignature = String(cls.getSignature?.()?.toString?.() || "");
        if (!className || !classSignature) continue;
        const entrypointMethods = (cls.getMethods?.() || [])
            .filter((method: ArkMethod) => isComponentEntrypointMethod(method));
        if (entrypointMethods.length === 0) continue;
        records.push({ className, classSignature, cls, entrypointMethods });
    }
    return records;
}

function getComponentClassRecordIndex(scene: Scene): ComponentClassRecordIndex {
    let cached = componentClassRecordIndexCache.get(scene);
    if (cached) return cached;
    const records = collectComponentClassRecords(scene);
    const byClassSignature = new Map<string, ComponentClassRecord>();
    for (const record of records) {
        byClassSignature.set(record.classSignature, record);
    }
    cached = { records, byClassSignature };
    componentClassRecordIndexCache.set(scene, cached);
    return cached;
}

function getComponentTargetsByMethodSignatureCache(scene: Scene): Map<string, string[]> {
    let cached = componentTargetsByMethodSignatureCache.get(scene);
    if (!cached) {
        cached = new Map<string, string[]>();
        componentTargetsByMethodSignatureCache.set(scene, cached);
    }
    return cached;
}

function isArkUiComponentClass(cls: any): boolean {
    return cls?.hasEntryDecorator?.() || cls?.hasComponentDecorator?.() || false;
}

function isComponentConstructionMethod(method: ArkMethod): boolean {
    const name = method.getName?.() || "";
    return name === "constructor" || name === "%instInit";
}

function isComponentEntrypointMethod(method: ArkMethod): boolean {
    const name = method.getName?.() || "";
    return hasArkMainOfficialComponentDeclarationForMethod(name)
        || method.hasBuilderDecorator?.() === true;
}

function collectMethodAndDeclaringInitializerStmts(method: ArkMethod): any[] {
    const out: any[] = [];
    const cfg = method.getCfg?.();
    if (cfg) out.push(...(cfg.getStmts?.() || []));

    const cls = method.getDeclaringArkClass?.();
    for (const field of cls?.getFields?.() || []) {
        const initializer = field?.getInitializer?.();
        if (Array.isArray(initializer)) {
            out.push(...initializer);
        } else if (initializer) {
            out.push(initializer);
        }
    }
    return out;
}

function resolveInstantiatedComponentRecords(
    scene: Scene,
    stmt: any,
    byClassSignature: ReadonlyMap<string, ComponentClassRecord>,
): ComponentClassRecord[] {
    const out = new Map<string, ComponentClassRecord>();
    const addByClassSignature = (classSignature: string | undefined): void => {
        if (!classSignature) return;
        const record = byClassSignature.get(classSignature);
        if (!record) return;
        out.set(record.classSignature, record);
    };

    if (stmt instanceof ArkAssignStmt) {
        const rightOp = stmt.getRightOp?.();
        if (rightOp instanceof ArkNewExpr) {
            addByClassSignature(classSignatureFromNewExpr(rightOp));
        }
    }

    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [...out.values()];
    addByClassSignature(invokeExpr.getMethodSignature?.()?.getDeclaringClassSignature?.()?.toString?.());
    for (const callee of resolveCalleeCandidates(scene, invokeExpr, {
        maxNameMatchCandidates: 8,
        enableDirectCallableTargets: false,
    })) {
        const classSignature = callee.method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        addByClassSignature(classSignature);
    }
    return [...out.values()];
}

function classSignatureFromNewExpr(expr: ArkNewExpr): string | undefined {
    const typeValue: any = expr.getType?.();
    const fromType = typeValue?.getClassSignature?.()?.toString?.();
    if (fromType) return fromType;
    const text = expr.toString?.() || "";
    const match = text.match(/new\s+(@[^:]+:\s*[^<\s]+)/);
    return match?.[1];
}

function addMethods(out: Map<string, ArkMethod>, methods: ArkMethod[]): void {
    for (const method of methods) {
        const sig = method.getSignature?.()?.toString?.();
        if (sig && !out.has(sig)) out.set(sig, method);
    }
}
