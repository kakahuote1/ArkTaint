import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";

interface ComponentClassRecord {
    className: string;
    cls: any;
    buildMethods: ArkMethod[];
}

export function expandReachableComponentEntrypoints(
    scene: Scene,
    reachableMethodSignatures: ReadonlySet<string>,
): ArkMethod[] {
    const componentRecords = collectComponentClassRecords(scene);
    if (componentRecords.length === 0) return [];

    const byName = new Map<string, ComponentClassRecord[]>();
    const byClassSignature = new Map<string, ComponentClassRecord>();
    for (const record of componentRecords) {
        const classSig = record.cls?.getSignature?.()?.toString?.() || "";
        if (classSig) byClassSignature.set(classSig, record);
        const bucket = byName.get(record.className) || [];
        bucket.push(record);
        byName.set(record.className, bucket);
    }

    const out = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        const methodSig = method.getSignature?.()?.toString?.();
        if (!methodSig || !reachableMethodSignatures.has(methodSig)) continue;

        const ownerRecord = byClassSignature.get(method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "");
        if (ownerRecord && isComponentConstructionMethod(method)) {
            addMethods(out, ownerRecord.buildMethods);
        }

        for (const stmt of collectMethodAndDeclaringInitializerStmts(method)) {
            for (const componentName of resolveInstantiatedComponentNames(stmt)) {
                for (const target of byName.get(componentName) || []) {
                    addMethods(out, target.buildMethods);
                }
            }
        }
    }

    return [...out.values()];
}

function collectComponentClassRecords(scene: Scene): ComponentClassRecord[] {
    const records: ComponentClassRecord[] = [];
    for (const cls of scene.getClasses()) {
        if (!isArkUiComponentClass(cls)) continue;
        const className = String(cls.getName?.() || "");
        if (!className) continue;
        const buildMethods = (cls.getMethods?.() || [])
            .filter((method: ArkMethod) => method.getName?.() === "build");
        if (buildMethods.length === 0) continue;
        records.push({ className, cls, buildMethods });
    }
    return records;
}

function isArkUiComponentClass(cls: any): boolean {
    return (cls?.getDecorators?.() || []).some((decorator: any) => {
        const kind = normalizeDecoratorKind(decorator?.getKind?.());
        return kind === "Entry" || kind === "Component" || kind === "ComponentV2" || kind === "CustomDialog";
    });
}

function isComponentConstructionMethod(method: ArkMethod): boolean {
    const name = method.getName?.() || "";
    return name === "constructor" || name === "%instInit";
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

function resolveInstantiatedComponentNames(stmt: any): string[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const names = new Set<string>();
    const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (isComponentFactoryName(methodName)) names.add(methodName);

    const sigText = String(invokeExpr.getMethodSignature?.()?.toString?.() || "");
    const sigMatch = sigText.match(/\.([A-Za-z_$][A-Za-z0-9_$]*)\(/);
    if (sigMatch && isComponentFactoryName(sigMatch[1])) names.add(sigMatch[1]);

    const stmtText = String(stmt.toString?.() || "");
    const textMatch = stmtText.match(/\.\s*([A-Z][A-Za-z0-9_$]*)\s*\(/);
    if (textMatch && isComponentFactoryName(textMatch[1])) names.add(textMatch[1]);

    return [...names];
}

function isComponentFactoryName(name: string): boolean {
    return /^[A-Z][A-Za-z0-9_$]*$/.test(String(name || ""));
}

function addMethods(out: Map<string, ArkMethod>, methods: ArkMethod[]): void {
    for (const method of methods) {
        const sig = method.getSignature?.()?.toString?.();
        if (sig && !out.has(sig)) out.set(sig, method);
    }
}

function normalizeDecoratorKind(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    return normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
}
