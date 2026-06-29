import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import {
    isAnonymousObjectCarrierClassSignature,
    isCallableValue,
    resolveMethodsFromAnonymousObjectCarrierByField,
} from "../queries/CalleeResolver";
import { collectFiniteStringCandidatesFromValue } from "../queries/FiniteStringCandidateResolver";
import { isSdkBackedMethodSignature } from "../queries/SdkProvenance";

export interface KnownOptionCallbackRegistrationMatch {
    callbackMethod: any;
    sourceMethod: any;
    registrationMethod: any;
    registrationInvokeExpr: any;
    registrationMethodName: string;
    registrationOwnerName: string;
    registrationSignature: string;
    callbackArgIndex: number;
    callbackFieldName?: string;
    reason: string;
    callbackFlavor: "channel" | "ui_event";
    registrationShape: "options_object_slot";
    slotFamily: "controller_option_slot" | "component_property_slot" | "project_component_option_slot" | "web_js_proxy_slot";
    recognitionLayer: "controller_options" | "component_options" | "web_js_proxy_options";
}

interface DeclaredFieldShape {
    name: string;
    typeText: string;
    type?: any;
}

interface WebProxyOptionShape {
    kind: "options";
    optionsArgIndex: number;
    objectFieldNames: string[];
    methodListFieldNames: string[];
}

interface WebProxyPositionalShape {
    kind: "positional";
    objectArgIndex: number;
    methodListArgIndex: number;
}

type WebProxyShape = WebProxyOptionShape | WebProxyPositionalShape;

export function resolveKnownOptionCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: any,
): KnownOptionCallbackRegistrationMatch[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const out = new Map<string, KnownOptionCallbackRegistrationMatch>();

    for (const binding of resolveDeclaredOptionFieldCallbacksFromStmt(stmt, scene, sourceMethod, invokeExpr)) {
        addUniqueBinding(out, binding, "declared-option");
    }
    for (const binding of resolveWebJavaScriptProxyCallbacksFromStmt(scene, sourceMethod, invokeExpr)) {
        addUniqueBinding(out, binding, "web-js-proxy");
    }
    for (const binding of resolveComponentPropertyCallbackInvocationsFromStmt(stmt, scene, sourceMethod, invokeExpr)) {
        addUniqueBinding(out, binding, "component-property");
    }
    for (const binding of resolveDirectProjectComponentOptionCallbacksFromStmt(scene, sourceMethod, invokeExpr)) {
        addUniqueBinding(out, binding, "project-component");
    }

    return [...out.values()];
}

function addUniqueBinding(
    out: Map<string, KnownOptionCallbackRegistrationMatch>,
    binding: KnownOptionCallbackRegistrationMatch,
    family: string,
): void {
    const callbackSignature = binding.callbackMethod.getSignature?.()?.toString?.() || "";
    if (!callbackSignature) return;
    const key = `${callbackSignature}|${family}:${binding.registrationSignature}:${binding.callbackArgIndex}:${binding.callbackFieldName || ""}`;
    if (out.has(key)) return;
    out.set(key, binding);
}

function resolveDeclaredOptionFieldCallbacksFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): KnownOptionCallbackRegistrationMatch[] {
    void stmt;
    const methodSig = invokeExpr.getMethodSignature?.();
    if (!hasModuleSemanticRegistrationProvenance(scene, sourceMethod, invokeExpr, methodSig)) {
        return [];
    }

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, KnownOptionCallbackRegistrationMatch>();
    for (let argIndex = 0; argIndex < explicitArgs.length; argIndex++) {
        const optionsValue = explicitArgs[argIndex];
        if (!optionsValue) continue;

        const callbackFieldNames = collectDeclaredCallableOptionFieldNames(scene, invokeExpr, argIndex);
        if (callbackFieldNames.length === 0) continue;

        for (const fieldName of callbackFieldNames) {
            for (const callbackMethod of resolveMethodsFromAnonymousObjectCarrierByField(scene, optionsValue, fieldName, {
                maxCandidates: 16,
                enableLocalBacktrace: true,
                maxBacktraceSteps: 6,
                maxVisitedDefs: 24,
            })) {
                if (!callbackMethod?.getCfg?.()) continue;
                const binding = buildOptionFieldBinding(
                    sourceMethod,
                    invokeExpr,
                    argIndex,
                    fieldName,
                    callbackMethod,
                    "channel",
                    "controller_option_slot",
                    "controller_options",
                    "Declared option callback field",
                );
                addUniqueBinding(out, binding, "declared-option");
            }
        }
    }
    return [...out.values()];
}

function resolveWebJavaScriptProxyCallbacksFromStmt(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): KnownOptionCallbackRegistrationMatch[] {
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!hasModuleSemanticRegistrationProvenance(scene, sourceMethod, invokeExpr, methodSig)) {
        return [];
    }

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, KnownOptionCallbackRegistrationMatch>();
    for (const shape of collectDeclaredWebProxyShapes(scene, invokeExpr)) {
        const registrations = shape.kind === "options"
            ? resolveWebProxyOptionShape(scene, sourceMethod, invokeExpr, explicitArgs, shape)
            : resolveWebProxyPositionalShape(scene, sourceMethod, invokeExpr, explicitArgs, shape);
        for (const registration of registrations) {
            addUniqueBinding(out, registration, "web-js-proxy");
        }
    }
    return [...out.values()];
}

function resolveWebProxyOptionShape(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    explicitArgs: any[],
    shape: WebProxyOptionShape,
): KnownOptionCallbackRegistrationMatch[] {
    const optionsValue = explicitArgs[shape.optionsArgIndex];
    if (!optionsValue) return [];

    const objectValues = new Map<string, any>();
    for (const fieldName of shape.objectFieldNames) {
        for (const value of collectAnonymousObjectFieldValues(scene, optionsValue, fieldName)) {
            const key = String(value?.toString?.() || value?.getName?.() || fieldName);
            if (!objectValues.has(key)) objectValues.set(key, value);
        }
    }

    const methodNames = new Set<string>();
    for (const fieldName of shape.methodListFieldNames) {
        for (const candidate of collectAnonymousObjectStringFieldCandidates(scene, optionsValue, fieldName)) {
            if (isValidJavaScriptProxyMethodName(candidate)) methodNames.add(candidate);
        }
    }

    return resolveWebProxyObjectMethods(scene, sourceMethod, invokeExpr, [...objectValues.values()], [...methodNames], shape.optionsArgIndex);
}

function resolveWebProxyPositionalShape(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    explicitArgs: any[],
    shape: WebProxyPositionalShape,
): KnownOptionCallbackRegistrationMatch[] {
    const objectValue = explicitArgs[shape.objectArgIndex];
    const methodListValue = explicitArgs[shape.methodListArgIndex];
    if (!objectValue || !methodListValue) return [];

    const methodNames = collectFiniteStringCandidatesFromValue(scene, methodListValue, 4)
        .filter(isValidJavaScriptProxyMethodName);
    return resolveWebProxyObjectMethods(scene, sourceMethod, invokeExpr, [objectValue], methodNames, shape.objectArgIndex);
}

function resolveWebProxyObjectMethods(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    objectValues: any[],
    methodNames: string[],
    callbackArgIndex: number,
): KnownOptionCallbackRegistrationMatch[] {
    const methodNameSet = [...new Set(methodNames)].sort((a, b) => a.localeCompare(b));
    if (objectValues.length === 0 || methodNameSet.length === 0) return [];

    const out = new Map<string, KnownOptionCallbackRegistrationMatch>();
    for (const objectValue of objectValues) {
        for (const methodListName of methodNameSet) {
            for (const callbackMethod of resolveObjectMethodByName(scene, sourceMethod, objectValue, methodListName)) {
                if (!callbackMethod?.getCfg?.()) continue;
                const binding = buildOptionFieldBinding(
                    sourceMethod,
                    invokeExpr,
                    callbackArgIndex,
                    methodListName,
                    callbackMethod,
                    "channel",
                    "web_js_proxy_slot",
                    "web_js_proxy_options",
                    "Web JavaScript proxy method",
                );
                addUniqueBinding(out, binding, "web-js-proxy");
            }
        }
    }
    return [...out.values()];
}

function isValidJavaScriptProxyMethodName(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(name || ""));
}

function collectDeclaredWebProxyShapes(scene: Scene, invokeExpr: any): WebProxyShape[] {
    const out: WebProxyShape[] = [];
    const parameterTypes = collectOptionParameterTypes(scene, invokeExpr);
    for (const [index, parameterType] of parameterTypes.entries()) {
        const fields = collectDeclaredFieldsFromType(scene, parameterType.type);
        const objectFieldNames = fields.filter(field => isObjectLikeTypeText(field.typeText)).map(field => field.name);
        const methodListFieldNames = fields.filter(field => isStringListTypeText(field.typeText)).map(field => field.name);
        if (objectFieldNames.length > 0 && methodListFieldNames.length > 0) {
            out.push({
                kind: "options",
                optionsArgIndex: index,
                objectFieldNames: uniqueSorted(objectFieldNames),
                methodListFieldNames: uniqueSorted(methodListFieldNames),
            });
        }
    }

    const objectArgIndexes = parameterTypes
        .filter(item => isObjectLikeTypeText(typeText(item.type)))
        .map(item => item.index);
    const methodListArgIndexes = parameterTypes
        .filter(item => isStringListTypeText(typeText(item.type)))
        .map(item => item.index);
    for (const objectArgIndex of objectArgIndexes) {
        for (const methodListArgIndex of methodListArgIndexes) {
            if (objectArgIndex === methodListArgIndex) continue;
            out.push({ kind: "positional", objectArgIndex, methodListArgIndex });
        }
    }
    return out;
}

function collectAnonymousObjectFieldValues(scene: Scene, objectValue: any, fieldName: string): any[] {
    const classSig = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        if (methodDeclaringClassSignatureText(method) !== classSig) continue;
        if (!isAnonymousCarrierInitMethod(method)) continue;
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const anyStmt = stmt as any;
            const left = anyStmt?.getLeftOp?.();
            const base = left?.getBase?.();
            const assignedFieldName = left?.getFieldSignature?.()?.getFieldName?.() || "";
            if (base?.getName?.() !== "this" || assignedFieldName !== fieldName) continue;
            const right = anyStmt?.getRightOp?.();
            const key = String(right?.toString?.() || right?.getName?.() || "");
            if (!right || seen.has(key)) continue;
            seen.add(key);
            out.push(right);
        }
    }
    return out;
}

function collectAnonymousObjectStringFieldCandidates(scene: Scene, objectValue: any, fieldName: string): string[] {
    const classSig = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out = new Set<string>();
    for (const method of scene.getMethods()) {
        if (methodDeclaringClassSignatureText(method) !== classSig) continue;
        if (!isAnonymousCarrierInitMethod(method)) continue;
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const anyStmt = stmt as any;
            const left = anyStmt?.getLeftOp?.();
            const base = left?.getBase?.();
            const assignedFieldName = left?.getFieldSignature?.()?.getFieldName?.() || "";
            if (base?.getName?.() !== "this" || assignedFieldName !== fieldName) continue;
            const right = anyStmt?.getRightOp?.();
            for (const candidate of collectFiniteStringCandidatesFromValue(scene, right, 4)) {
                out.add(candidate);
            }
            for (const candidate of collectArrayElementStringAssignments(cfg, right)) {
                out.add(candidate);
            }
        }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
}

function collectArrayElementStringAssignments(cfg: any, arrayValue: any): string[] {
    const arrayName = String(arrayValue?.getName?.() || arrayValue?.toString?.() || "").trim();
    if (!arrayName) return [];
    const out = new Set<string>();
    for (const stmt of cfg?.getStmts?.() || []) {
        const anyStmt = stmt as any;
        const leftText = String(anyStmt?.getLeftOp?.()?.toString?.() || "");
        if (!leftText.startsWith(`${arrayName}[`)) continue;
        const right = anyStmt?.getRightOp?.();
        const literal = normalizeClosedStringLiteral(String(right?.toString?.() || ""));
        if (literal) out.add(literal);
    }
    return [...out];
}

function normalizeClosedStringLiteral(text: string): string | undefined {
    const raw = String(text || "").trim();
    if (raw.length < 2) return undefined;
    const quote = raw[0];
    if ((quote !== "'" && quote !== "\"" && quote !== "`") || raw[raw.length - 1] !== quote) return undefined;
    return raw.slice(1, raw.length - 1);
}

function resolveObjectMethodByName(
    scene: Scene,
    sourceMethod: any,
    objectValue: any,
    methodName: string,
    depth: number = 0,
    visiting: Set<string> = new Set<string>(),
): any[] {
    if (!objectValue || depth > 4) return [];
    const visitKey = `${depth}|${String(objectValue?.toString?.() || objectValue?.getName?.() || "")}|${methodName}`;
    if (visiting.has(visitKey)) return [];
    visiting.add(visitKey);

    const out = new Map<string, any>();
    const add = (method: any): void => {
        const sig = method?.getSignature?.()?.toString?.() || "";
        if (!sig || out.has(sig) || !method?.getCfg?.()) return;
        out.set(sig, method);
    };

    for (const method of resolveMethodsFromAnonymousObjectCarrierByField(scene, objectValue, methodName, {
        maxCandidates: 16,
        enableLocalBacktrace: true,
        maxBacktraceSteps: 6,
        maxVisitedDefs: 24,
    })) {
        add(method);
    }

    const typeClassSig = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (typeClassSig && !isAnonymousObjectCarrierClassSignature(typeClassSig)) {
        const klass = scene.getClass?.(objectValue.getType?.()?.getClassSignature?.());
        for (const method of klass?.getMethods?.() || []) {
            if (method?.getName?.() === methodName) add(method);
        }
    }

    const declaringStmt = objectValue?.getDeclaringStmt?.();
    const rightOp = declaringStmt?.getRightOp?.();
    if (rightOp && rightOp !== objectValue) {
        for (const method of resolveObjectMethodByName(scene, sourceMethod, rightOp, methodName, depth + 1, visiting)) {
            add(method);
        }
    }

    const fieldName = objectValue?.getFieldSignature?.()?.getFieldName?.() || "";
    const baseName = objectValue?.getBase?.()?.getName?.() || "";
    if (fieldName && baseName === "this") {
        const cls = sourceMethod?.getDeclaringArkClass?.();
        for (const field of cls?.getFields?.() || []) {
            if (field?.getName?.() !== fieldName) continue;
            const initializer = field?.getInitializer?.();
            const initializers = Array.isArray(initializer) ? initializer : initializer ? [initializer] : [];
            for (const init of initializers) {
                const value = init?.getRightOp?.() || init;
                for (const method of resolveObjectMethodByName(scene, sourceMethod, value, methodName, depth + 1, visiting)) {
                    add(method);
                }
            }
        }
    }

    return [...out.values()];
}

const componentPropertyCallbackCache = new WeakMap<Scene, Map<string, any[]>>();

function resolveDirectProjectComponentOptionCallbacksFromStmt(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): KnownOptionCallbackRegistrationMatch[] {
    if (!isArkUiCompositionSourceMethod(sourceMethod)) return [];
    const componentClass = resolveProjectComponentFactoryClass(scene, invokeExpr);
    if (!componentClass) return [];

    const optionsValue = invokeExpr.getArgs?.()?.[0];
    if (!optionsValue) return [];

    const componentFieldNames = new Set<string>((componentClass.getFields?.() || [])
        .map((field: any) => String(field?.getName?.() || "").trim())
        .filter(Boolean));
    const callbackFieldNames = collectAnonymousObjectCallableFieldNames(scene, optionsValue)
        .filter(fieldName => componentFieldNames.has(fieldName));
    if (callbackFieldNames.length === 0) return [];

    const out: KnownOptionCallbackRegistrationMatch[] = [];
    for (const fieldName of callbackFieldNames) {
        const callbackMethods = resolveMethodsFromAnonymousObjectCarrierByField(scene, optionsValue, fieldName, {
            maxCandidates: 16,
            enableLocalBacktrace: true,
            maxBacktraceSteps: 6,
            maxVisitedDefs: 24,
        }).filter(method => !!method?.getCfg?.());
        for (const callbackMethod of callbackMethods) {
            out.push(buildOptionFieldBinding(
                sourceMethod,
                invokeExpr,
                0,
                fieldName,
                callbackMethod,
                "ui_event",
                "project_component_option_slot",
                "component_options",
                "Project component option callback",
                componentClass.getName?.() || "",
            ));
        }
    }
    return out;
}

function isArkUiCompositionSourceMethod(method: any): boolean {
    const cls = method?.getDeclaringArkClass?.();
    if (isArkUiComponentClass(cls)) return true;
    return !!method?.hasBuilderDecorator?.();
}

function resolveProjectComponentFactoryClass(scene: Scene, invokeExpr: any): any | undefined {
    const classSignature = invokeExpr?.getMethodSignature?.()?.getDeclaringClassSignature?.();
    if (!classSignature) return undefined;
    const cls = scene.getClass?.(classSignature);
    if (!cls || !isArkUiComponentClass(cls) || isSdkBackedArkClass(scene, cls)) {
        return undefined;
    }
    return cls;
}

function collectAnonymousObjectCallableFieldNames(scene: Scene, objectValue: any): string[] {
    const classSig = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out = new Set<string>();
    for (const method of scene.getMethods()) {
        if (methodDeclaringClassSignatureText(method) !== classSig) continue;
        const methodName = method?.getName?.() || "";
        const fieldFromMethod = extractAnonymousCarrierMethodFieldName(methodName);
        if (fieldFromMethod) {
            out.add(fieldFromMethod);
        }
        if (!isAnonymousCarrierInitMethod(method)) continue;
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const anyStmt = stmt as any;
            const left = anyStmt?.getLeftOp?.();
            const base = left?.getBase?.();
            const fieldName = left?.getFieldSignature?.()?.getFieldName?.() || "";
            if (base?.getName?.() !== "this" || !fieldName) continue;
            if (isCallableValue(anyStmt?.getRightOp?.())) {
                out.add(fieldName);
            }
        }
    }
    return [...out].sort((left, right) => left.localeCompare(right));
}

function methodDeclaringClassSignatureText(method: any): string {
    return String(method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.()
        || method?.getSignature?.()?.getDeclaringClassSignature?.()?.toString?.()
        || "");
}

function isAnonymousCarrierInitMethod(method: any): boolean {
    const methodName = method?.getName?.() || "";
    return methodName.includes("constructor(") || methodName.includes("%instInit");
}

function extractAnonymousCarrierMethodFieldName(methodName: string): string | undefined {
    const parts = String(methodName || "").split("$").filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index--) {
        const candidate = parts[index].replace(/[()<>]/g, "");
        if (isValidObjectFieldName(candidate)) return candidate;
    }
    return isValidObjectFieldName(methodName) ? methodName : undefined;
}

function isValidObjectFieldName(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(name || ""));
}

function resolveComponentPropertyCallbackInvocationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): KnownOptionCallbackRegistrationMatch[] {
    const fieldName = resolveThisFieldPtrInvokeName(stmt);
    if (!fieldName) return [];

    const componentClass = sourceMethod?.getDeclaringArkClass?.();
    if (!isArkUiComponentClass(componentClass)) return [];
    if (!componentClassHasField(componentClass, fieldName)) return [];

    const callbackMethods = resolveComponentFactoryCallbacks(scene, componentClass, fieldName)
        .filter(method => !!method?.getCfg?.());
    const out: KnownOptionCallbackRegistrationMatch[] = [];
    for (const callbackMethod of callbackMethods) {
        out.push(buildOptionFieldBinding(
            sourceMethod,
            invokeExpr,
            0,
            fieldName,
            callbackMethod,
            "channel",
            "component_property_slot",
            "component_options",
            "ArkUI component property callback",
            componentClass.getName?.() || "",
        ));
    }
    return out;
}

function resolveThisFieldPtrInvokeName(stmt: any): string | undefined {
    const text = String(stmt?.toString?.() || "");
    const match = text.match(/\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*</);
    return match?.[1];
}

function resolveComponentFactoryCallbacks(scene: Scene, componentClass: any, fieldName: string): any[] {
    let sceneCache = componentPropertyCallbackCache.get(scene);
    if (!sceneCache) {
        sceneCache = new Map<string, any[]>();
        componentPropertyCallbackCache.set(scene, sceneCache);
    }
    const componentSignature = String(componentClass?.getSignature?.()?.toString?.() || componentClass?.getName?.() || "");
    const cacheKey = `${componentSignature}.${fieldName}`;
    const cached = sceneCache.get(cacheKey);
    if (cached) return cached;

    const out = new Map<string, any>();
    const addFromStmt = (stmt: any): void => {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr || !isComponentFactoryInvoke(invokeExpr, componentClass)) return;
        const optionsValue = invokeExpr.getArgs?.()?.[0];
        if (!optionsValue) return;
        for (const callbackMethod of resolveMethodsFromAnonymousObjectCarrierByField(scene, optionsValue, fieldName)) {
            const signature = callbackMethod?.getSignature?.()?.toString?.() || "";
            if (!signature || out.has(signature)) continue;
            out.set(signature, callbackMethod);
        }
    };

    for (const cls of scene.getClasses()) {
        for (const field of cls?.getFields?.() || []) {
            const initializer = field?.getInitializer?.();
            const stmts = Array.isArray(initializer) ? initializer : initializer ? [initializer] : [];
            for (const stmt of stmts) addFromStmt(stmt);
        }
        for (const method of cls?.getMethods?.() || []) {
            const cfg = method?.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts?.() || []) addFromStmt(stmt);
        }
    }

    const values = [...out.values()];
    sceneCache.set(cacheKey, values);
    return values;
}

function isComponentFactoryInvoke(invokeExpr: any, componentClass: any): boolean {
    const invokedClassSignature = String(invokeExpr?.getMethodSignature?.()?.getDeclaringClassSignature?.()?.toString?.() || "");
    const componentSignature = String(componentClass?.getSignature?.()?.toString?.() || "");
    return !!invokedClassSignature && invokedClassSignature === componentSignature;
}

function componentClassHasField(cls: any, fieldName: string): boolean {
    return (cls?.getFields?.() || []).some((field: any) => field?.getName?.() === fieldName);
}

function isArkUiComponentClass(cls: any): boolean {
    return !!(cls?.hasEntryDecorator?.() || cls?.hasComponentDecorator?.());
}

function isSdkBackedArkClass(scene: Scene, cls: any): boolean {
    const fileSig = cls?.getDeclaringArkFile?.()?.getFileSignature?.();
    return !!fileSig && scene.hasSdkFile(fileSig);
}

function buildOptionFieldBinding(
    sourceMethod: any,
    invokeExpr: any,
    callbackArgIndex: number,
    callbackFieldName: string,
    callbackMethod: any,
    callbackFlavor: "channel" | "ui_event",
    slotFamily: KnownOptionCallbackRegistrationMatch["slotFamily"],
    recognitionLayer: KnownOptionCallbackRegistrationMatch["recognitionLayer"],
    reasonPrefix: string,
    registrationOwnerNameOverride?: string,
): KnownOptionCallbackRegistrationMatch {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const ownerName = registrationOwnerNameOverride
        || methodSig?.getDeclaringClassSignature?.()?.getClassName?.()
        || "";
    const registrationSignature = methodSig?.toString?.() || "";
    return {
        callbackMethod,
        sourceMethod,
        registrationMethod: sourceMethod,
        registrationInvokeExpr: invokeExpr,
        registrationMethodName: methodName,
        registrationOwnerName: ownerName,
        registrationSignature,
        callbackArgIndex,
        callbackFieldName,
        reason: `${reasonPrefix} ${ownerName}.${callbackFieldName} from ${sourceMethod.getName?.() || ""}`.trim(),
        callbackFlavor,
        registrationShape: "options_object_slot",
        slotFamily,
        recognitionLayer,
    };
}

/** True only when the callee is backed by an SDK declaration that carries exact parameter shape evidence. */
export function hasModuleSemanticRegistrationProvenance(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    methodSig: any,
): boolean {
    return isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr });
}

function collectDeclaredCallableOptionFieldNames(scene: Scene, invokeExpr: any, optionsArgIndex: number): string[] {
    const out = new Set<string>();
    for (const parameterType of collectOptionParameterTypes(scene, invokeExpr, optionsArgIndex)) {
        for (const field of collectDeclaredFieldsFromType(scene, parameterType.type)) {
            if (isCallableLikeType(scene, field.type) || isInlineCallableTypeText(field.typeText)) {
                out.add(field.name);
            }
        }
    }
    return [...out].sort((left, right) => left.localeCompare(right));
}

function collectOptionParameterTypes(scene: Scene, invokeExpr: any, onlyIndex?: number): Array<{ index: number; type: any }> {
    const out: Array<{ index: number; type: any }> = [];
    const seen = new Set<string>();
    const pushType = (index: number, type: any): void => {
        if (onlyIndex !== undefined && index !== onlyIndex) return;
        if (!type) return;
        const key = `${index}:${typeText(type)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ index, type });
    };

    const invokeParameters = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getParameters?.() || [];
    invokeParameters.forEach((parameter: any, index: number) => pushType(index, parameter?.getType?.()));

    return out;
}

function collectDeclaredFieldsFromType(scene: Scene, type: any): DeclaredFieldShape[] {
    const out = new Map<string, DeclaredFieldShape>();
    const add = (name: string, fieldTypeText: string, fieldType?: any): void => {
        const normalizedName = String(name || "").trim();
        const normalizedType = String(fieldTypeText || "").trim();
        if (!normalizedName || !normalizedType || out.has(normalizedName)) return;
        out.set(normalizedName, { name: normalizedName, typeText: normalizedType, type: fieldType });
    };

    for (const field of extractInlineObjectFields(typeText(type))) {
        add(field.name, field.typeText);
    }

    for (const klass of resolveArkClassesFromType(scene, type)) {
        for (const field of klass?.getFields?.() || []) {
            const fieldType = field?.getType?.();
            add(field?.getName?.() || "", typeText(fieldType), fieldType);
        }
    }

    return [...out.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function extractInlineObjectFields(rawTypeText: string): DeclaredFieldShape[] {
    const text = String(rawTypeText || "").trim();
    if (!text.startsWith("{") || !text.endsWith("}")) return [];

    const body = text.slice(1, text.length - 1);
    const fields: DeclaredFieldShape[] = [];
    const re = /([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:\s*([^,;}]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
        const name = match[1] || "";
        const fieldTypeText = match[2] || "";
        if (name && fieldTypeText) fields.push({ name, typeText: fieldTypeText.trim() });
    }
    return fields;
}

function resolveArkClassesFromType(
    scene: Scene,
    type: any,
    depth: number = 0,
    seen: Set<string> = new Set<string>(),
): any[] {
    if (!type || depth > 4) {
        return [];
    }

    const out: any[] = [];
    const pushUnique = (klass: any): void => {
        if (!klass) return;
        const key = klass.getSignature?.()?.toString?.() || klass.getName?.() || "";
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(klass);
    };

    const classSignature = type.getClassSignature?.();
    if (classSignature) {
        pushUnique(scene.getClass(classSignature));
    }

    const originalType = type.getOriginalType?.();
    if (originalType) {
        for (const klass of resolveArkClassesFromType(scene, originalType, depth + 1, seen)) {
            pushUnique(klass);
        }
    }

    const unionTypes = type.getTypes?.();
    if (Array.isArray(unionTypes)) {
        for (const unionType of unionTypes) {
            for (const klass of resolveArkClassesFromType(scene, unionType, depth + 1, seen)) {
                pushUnique(klass);
            }
        }
    }

    const currType = type.getCurrType?.();
    if (currType && currType !== type) {
        for (const klass of resolveArkClassesFromType(scene, currType, depth + 1, seen)) {
            pushUnique(klass);
        }
    }

    return out;
}

function typeText(type: any): string {
    return String(type?.toString?.() || type?.getTypeString?.() || "").trim();
}

function isCallableLikeType(
    scene: Scene,
    type: any,
    depth: number = 0,
): boolean {
    void scene;
    if (!type || depth > 4) {
        return false;
    }
    if (type.getMethodSignature?.()) {
        return true;
    }
    const methodSignatures = type.getMethodSignatures?.();
    if (Array.isArray(methodSignatures) && methodSignatures.length > 0) {
        return true;
    }
    const callSignature = type.getCallSignature?.() || type.getFunctionSignature?.() || type.getFuncSignature?.();
    if (callSignature) {
        return true;
    }

    const originalType = type.getOriginalType?.();
    if (originalType && isCallableLikeType(scene, originalType, depth + 1)) {
        return true;
    }

    const unionTypes = type.getTypes?.();
    if (Array.isArray(unionTypes) && unionTypes.some((unionType: any) => isCallableLikeType(scene, unionType, depth + 1))) {
        return true;
    }

    const currType = type.getCurrType?.();
    if (currType && currType !== type && isCallableLikeType(scene, currType, depth + 1)) {
        return true;
    }

    return false;
}

function isInlineCallableTypeText(text: string): boolean {
    const normalized = String(text || "").trim();
    return /\([^)]*\)\s*=>/.test(normalized)
        || /^new\s*\([^)]*\)\s*=>/.test(normalized);
}

function isStringListTypeText(text: string): boolean {
    return /\b(Array\s*<\s*string\s*>|string\s*\[\])\b/i.test(String(text || ""));
}

function isObjectLikeTypeText(text: string): boolean {
    const normalized = String(text || "").trim();
    return /^object$/i.test(normalized)
        || /^\{.*\}$/.test(normalized)
        || /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(normalized);
}

function uniqueSorted(values: string[]): string[] {
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
