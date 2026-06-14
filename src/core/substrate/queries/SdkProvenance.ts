import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkClass } from "../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";

export interface SdkMethodProvenanceOptions {
    sourceMethod?: ArkMethod;
    invokeExpr?: any;
}

export interface SdkImportScopeCandidates {
    classTexts: string[];
    moduleTexts: string[];
    fileTexts: string[];
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

export function resolveSdkImportScopeCandidates(
    sourceMethod: ArkMethod | undefined,
    invokeExpr: any,
    scene?: Scene,
): SdkImportScopeCandidates {
    const classTexts = new Set<string>();
    const moduleTexts = new Set<string>();
    const fileTexts = new Set<string>();
    if (!sourceMethod || !invokeExpr) {
        return { classTexts: [], moduleTexts: [], fileTexts: [] };
    }

    const sourceFile = getSourceFile(sourceMethod);
    const symbols = new Set<string>();
    const methodSig = invokeExpr.getMethodSignature?.();
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (className) {
        symbols.add(className);
    }

    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName) {
        symbols.add(methodName);
    }

    const baseName = resolveValueSymbolName(invokeExpr.getBase?.());
    if (baseName) {
        symbols.add(baseName);
    }
    addSdkTypeScopeCandidates(sourceFile, invokeExpr.getBase?.(), classTexts, moduleTexts, fileTexts);

    walkInvokeBaseChain(invokeExpr, (rhs) => {
        const ancestorSig = rhs.getMethodSignature?.();
        const ancestorClassName = ancestorSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
        if (ancestorClassName) {
            symbols.add(ancestorClassName);
        }
        const ancestorBaseName = resolveValueSymbolName(rhs.getBase?.());
        if (ancestorBaseName) {
            symbols.add(ancestorBaseName);
        }
        addSdkTypeScopeCandidates(sourceFile, rhs, classTexts, moduleTexts, fileTexts);
        addGetterReturnScopeCandidates(scene, sourceFile, rhs, classTexts, moduleTexts, fileTexts);
        return false;
    });

    for (const symbol of symbols) {
        if (!symbol) continue;
        const importFrom = sourceFile?.getImportInfoBy?.(symbol)?.getFrom?.() || "";
        if (!isSdkImportFrom(importFrom)) {
            continue;
        }
        addClassLikeCandidates(classTexts, symbol);
        moduleTexts.add(importFrom);
        fileTexts.add(importFrom);
        addImportPathCandidates(classTexts, importFrom);
    }

    return {
        classTexts: [...classTexts.values()],
        moduleTexts: [...moduleTexts.values()],
        fileTexts: [...fileTexts.values()],
    };
}

function addGetterReturnScopeCandidates(
    scene: Scene | undefined,
    sourceFile: any,
    rhs: any,
    classTexts: Set<string>,
    moduleTexts: Set<string>,
    fileTexts: Set<string>,
): void {
    if (!scene || !sourceFile || !rhs?.getMethodSignature) return;
    const methodSignatureText = safeToString(rhs.getMethodSignature?.());
    if (!methodSignatureText) return;

    for (const method of scene.getMethods?.() || []) {
        if (safeToString(method?.getSignature?.()) !== methodSignatureText) continue;
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const returnedValue = (stmt as any)?.getOp?.();
            if (!returnedValue) continue;
            addSdkTypeTextCandidates(
                sourceFile,
                safeToString(returnedValue?.getType?.()),
                classTexts,
                moduleTexts,
                fileTexts,
            );
            const returnedDecl = returnedValue?.getDeclaringStmt?.();
            const returnedRhs = returnedDecl?.getRightOp?.();
            addSdkTypeTextCandidates(
                sourceFile,
                safeToString(returnedRhs?.getType?.()),
                classTexts,
                moduleTexts,
                fileTexts,
            );
            const fieldSig = returnedRhs?.getFieldSignature?.();
            addSdkTypeTextCandidates(
                sourceFile,
                safeToString(fieldSig?.getType?.()),
                classTexts,
                moduleTexts,
                fileTexts,
            );
        }
    }
}

function addSdkTypeScopeCandidates(
    sourceFile: any,
    value: any,
    classTexts: Set<string>,
    moduleTexts: Set<string>,
    fileTexts: Set<string>,
): void {
    if (!sourceFile || !value) return;
    addSdkTypeTextCandidates(
        sourceFile,
        safeToString(value?.getType?.()),
        classTexts,
        moduleTexts,
        fileTexts,
    );

    const defStmt = value?.getDeclaringStmt?.();
    const rhs = defStmt?.getRightOp?.();
    if (!rhs || rhs === value) return;
    addSdkTypeTextCandidates(
        sourceFile,
        safeToString(rhs?.getType?.()),
        classTexts,
        moduleTexts,
        fileTexts,
    );

    const fieldSig = rhs?.getFieldSignature?.();
    addSdkTypeTextCandidates(
        sourceFile,
        safeToString(fieldSig?.getType?.()),
        classTexts,
        moduleTexts,
        fileTexts,
    );
}

function addSdkTypeTextCandidates(
    sourceFile: any,
    typeText: string,
    classTexts: Set<string>,
    moduleTexts: Set<string>,
    fileTexts: Set<string>,
): void {
    addSdkNamespaceQualifiedTypeCandidates(sourceFile, typeText, classTexts, moduleTexts, fileTexts);
    addSdkImportedTypeCandidates(sourceFile, typeText, classTexts, moduleTexts, fileTexts);
    addSdkInlineImportTypeCandidates(typeText, classTexts, moduleTexts, fileTexts);
}

function addSdkNamespaceQualifiedTypeCandidates(
    sourceFile: any,
    typeText: string,
    classTexts: Set<string>,
    moduleTexts: Set<string>,
    fileTexts: Set<string>,
): void {
    if (!typeText) return;
    const re = /(?:^|[^A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(typeText)) !== null) {
        const namespace = match[1] || "";
        const typeName = match[2] || "";
        const importFrom = sourceFile?.getImportInfoBy?.(namespace)?.getFrom?.() || "";
        if (!namespace || !typeName || !isSdkImportFrom(importFrom)) {
            continue;
        }
        addClassLikeCandidates(classTexts, namespace);
        addClassLikeCandidates(classTexts, typeName);
        moduleTexts.add(importFrom);
        fileTexts.add(importFrom);
        addImportPathCandidates(classTexts, importFrom);
    }
}

function addSdkImportedTypeCandidates(
    sourceFile: any,
    typeText: string,
    classTexts: Set<string>,
    moduleTexts: Set<string>,
    fileTexts: Set<string>,
): void {
    if (!sourceFile || !typeText) return;
    const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(typeText)) !== null) {
        const symbol = match[1] || "";
        if (!symbol) continue;
        const importFrom = sourceFile?.getImportInfoBy?.(symbol)?.getFrom?.() || "";
        if (!isSdkImportFrom(importFrom)) {
            continue;
        }
        addClassLikeCandidates(classTexts, symbol);
        moduleTexts.add(importFrom);
        fileTexts.add(importFrom);
        addImportPathCandidates(classTexts, importFrom);
    }
}

function addSdkInlineImportTypeCandidates(
    typeText: string,
    classTexts: Set<string>,
    moduleTexts: Set<string>,
    fileTexts: Set<string>,
): void {
    if (!typeText) return;
    const re = /import\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(typeText)) !== null) {
        const importFrom = match[1] || "";
        const typeName = match[2] || "";
        if (!typeName || !isSdkImportFrom(importFrom)) {
            continue;
        }
        addClassLikeCandidates(classTexts, typeName);
        moduleTexts.add(importFrom);
        fileTexts.add(importFrom);
        addImportPathCandidates(classTexts, importFrom);
    }
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

function safeToString(value: any): string {
    try {
        return String(value?.toString?.() || "").trim();
    } catch {
        return "";
    }
}

function addClassLikeCandidates(target: Set<string>, raw: string): void {
    const text = String(raw || "").trim();
    if (!text) return;
    target.add(text);
    if (/^[a-z]/.test(text)) {
        target.add(text[0].toUpperCase() + text.slice(1));
    }
}

function addImportPathCandidates(target: Set<string>, importFrom: string): void {
    const normalized = String(importFrom || "")
        .replace(/^@(kit|ohos|system)(?:[./\/])?/, "")
        .trim();
    if (!normalized) {
        return;
    }

    const segments = normalized
        .split(/[./\\_-]+/)
        .map(segment => segment.trim())
        .filter(Boolean);
    if (segments.length === 0) {
        addClassLikeCandidates(target, normalized);
        return;
    }

    for (const segment of segments) {
        addClassLikeCandidates(target, segment);
    }

    if (segments.length >= 2) {
        const pair = segments.slice(-2);
        addClassLikeCandidates(target, toCamelComposite(pair));
        addClassLikeCandidates(target, toPascalComposite(pair));
    }
}

function toCamelComposite(segments: string[]): string {
    if (segments.length === 0) return "";
    const [head, ...rest] = segments;
    return String(head || "").toLowerCase() + rest.map(segment => upperFirst(segment)).join("");
}

function toPascalComposite(segments: string[]): string {
    return segments.map(segment => upperFirst(segment)).join("");
}

function upperFirst(text: string): string {
    if (!text) return "";
    return text[0].toUpperCase() + text.slice(1);
}
