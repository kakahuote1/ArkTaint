import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkClass } from "../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";

export interface SdkMethodProvenanceOptions {
    sourceMethod?: ArkMethod;
    invokeExpr?: any;
}

export function isSdkBackedMethodSignature(
    scene: Scene,
    methodSig: any,
    options: SdkMethodProvenanceOptions = {},
): boolean {
    if (isSdkBackedByDeclaringFile(scene, methodSig)) {
        return true;
    }
    if (isSdkBackedByDeclaringClass(scene, methodSig)) {
        return true;
    }
    if (isSdkBackedByInvokeBaseType(scene, options.invokeExpr)) {
        return true;
    }
    if (isSdkBackedByImportProvenance(options.sourceMethod, methodSig)) {
        return true;
    }
    if (isSdkBackedByCallChainAncestry(scene, options.sourceMethod, options.invokeExpr)) {
        return true;
    }
    return false;
}

function isSdkBackedByDeclaringFile(scene: Scene, methodSig: any): boolean {
    const fileSig = methodSig?.getDeclaringClassSignature?.()?.getDeclaringFileSignature?.();
    return !!fileSig && scene.hasSdkFile(fileSig);
}

function isSdkBackedByDeclaringClass(scene: Scene, methodSig: any): boolean {
    const classSignature = methodSig?.getDeclaringClassSignature?.();
    if (!classSignature) {
        return false;
    }
    const declaringClass = scene.getClass?.(classSignature);
    return isSdkBackedArkClass(scene, declaringClass);
}

function isSdkBackedByInvokeBaseType(scene: Scene, invokeExpr: any): boolean {
    const baseClassSignature = invokeExpr?.getBase?.()?.getType?.()?.getClassSignature?.();
    if (!baseClassSignature) {
        return false;
    }
    const baseClass = scene.getClass?.(baseClassSignature);
    return isSdkBackedArkClass(scene, baseClass);
}

function isSdkBackedByImportProvenance(sourceMethod: ArkMethod | undefined, methodSig: any): boolean {
    if (!sourceMethod) {
        return false;
    }
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (!className) {
        return false;
    }
    const sourceFile = sourceMethod.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || sourceMethod.getDeclaringArkFile?.();
    const importInfo = sourceFile?.getImportInfoBy?.(className);
    const importFrom = importInfo?.getFrom?.() || "";
    return isSdkImportFrom(importFrom);
}

function isSdkBackedArkClass(scene: Scene, arkClass: ArkClass | null | undefined): boolean {
    let cursor = arkClass || null;
    let depth = 0;
    while (cursor && depth < 8) {
        const fileSig = cursor.getDeclaringArkFile?.()?.getFileSignature?.();
        if (fileSig && scene.hasSdkFile(fileSig)) {
            return true;
        }
        cursor = cursor.getSuperClass?.() || null;
        depth += 1;
    }
    return false;
}

export function isSdkImportFrom(importFrom: string): boolean {
    return /^@(kit|ohos|system)(\.|\/|$)/.test(importFrom || "");
}

export function isExternalImportFrom(importFrom: string): boolean {
    const normalized = (importFrom || "").trim();
    if (normalized === "" || normalized.startsWith("./") || normalized.startsWith("../")) {
        return false;
    }
    if (normalized.startsWith("@")) {
        return true;
    }
    return false;
}

const CHAIN_ANCESTRY_MAX_DEPTH = 20;

/**
 * Layer 5: Trace the SSA definition chain of the invoke's base variable.
 * In ArkUI chain calls like `Button().width().height().onClick(cb)`,
 * intermediate styling methods may lack declarations (type → unknown),
 * but the chain root (`Button()`) is SDK-backed. Walking back through
 * `Local.getDeclaringStmt()` recovers this ancestry.
 */
function isSdkBackedByCallChainAncestry(
    scene: Scene,
    sourceMethod: ArkMethod | undefined,
    invokeExpr: any,
): boolean {
    if (!sourceMethod) return false;
    return walkInvokeBaseChain(invokeExpr, (rhs) => {
        const ancestorSig = rhs.getMethodSignature?.();
        if (ancestorSig) {
            if (isSdkBackedByDeclaringFile(scene, ancestorSig)
                || isSdkBackedByDeclaringClass(scene, ancestorSig)) {
                return true;
            }
        }
        return false;
    });
}

export function isExternalImportRooted(
    sourceMethod: ArkMethod | undefined,
    invokeExpr: any,
): boolean {
    if (!sourceMethod || !invokeExpr) {
        return false;
    }

    const methodSig = invokeExpr.getMethodSignature?.();
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (className && hasImportRootedSymbol(sourceMethod, className, isExternalImportFrom)) {
        return true;
    }

    const baseName = resolveValueSymbolName(invokeExpr.getBase?.());
    if (baseName && hasImportRootedSymbol(sourceMethod, baseName, isExternalImportFrom)) {
        return true;
    }

    return walkInvokeBaseChain(invokeExpr, (rhs) => {
        const ancestorSig = rhs.getMethodSignature?.();
        const ancestorClassName = ancestorSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
        if (ancestorClassName && hasImportRootedSymbol(sourceMethod, ancestorClassName, isExternalImportFrom)) {
            return true;
        }
        const ancestorBaseName = resolveValueSymbolName(rhs.getBase?.());
        return !!ancestorBaseName && hasImportRootedSymbol(sourceMethod, ancestorBaseName, isExternalImportFrom);
    });
}

function walkInvokeBaseChain(
    invokeExpr: any,
    visitRhs: (rhs: any) => boolean,
): boolean {
    const base = invokeExpr?.getBase?.();
    if (!base) return false;

    let cursor: any = base;
    let depth = 0;
    while (cursor && depth < CHAIN_ANCESTRY_MAX_DEPTH) {
        const defStmt = cursor.getDeclaringStmt?.();
        if (!defStmt) break;
        const rhs = defStmt.getRightOp?.();
        if (!rhs) break;
        if (visitRhs(rhs)) {
            return true;
        }
        const nextBase = rhs.getBase?.();
        if (!nextBase || nextBase === cursor) break;
        cursor = nextBase;
        depth += 1;
    }
    return false;
}

function hasImportRootedSymbol(
    sourceMethod: ArkMethod | undefined,
    symbolName: string,
    predicate: (importFrom: string) => boolean,
): boolean {
    const sourceFile = getSourceFile(sourceMethod);
    const importFrom = sourceFile?.getImportInfoBy?.(symbolName)?.getFrom?.() || "";
    return predicate(importFrom);
}

function getSourceFile(sourceMethod: ArkMethod | undefined): any {
    return sourceMethod?.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || sourceMethod?.getDeclaringArkFile?.();
}

function resolveValueSymbolName(value: any): string {
    return value?.getName?.() || value?.toString?.() || "";
}
