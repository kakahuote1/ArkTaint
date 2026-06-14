import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import {
    isAnonymousObjectCarrierClassSignature,
    isCallableValue,
    resolveCalleeCandidates,
    resolveMethodsFromAnonymousObjectCarrierByField,
} from "../queries/CalleeResolver";
import { collectFiniteStringCandidatesFromValue } from "../queries/FiniteStringCandidateResolver";
import { isSdkBackedMethodSignature } from "../queries/SdkProvenance";

interface OwnerQualifiedOptionObjectCallbackSpec {
    kind: "owner_qualified";
    ownerClassNames?: Set<string>;
    methodNames: Set<string>;
    optionsArgIndex: number;
    callbackFieldNames: Set<string>;
    reasonLabel: string;
}

interface ModuleSemanticOptionObjectCallbackSpec {
    kind: "module_semantic";
    methodNames: Set<string>;
    optionsArgIndex: number;
    callbackFieldNames: Set<string>;
    requiredFieldNames?: Set<string>;
    reasonLabel: string;
}

type OptionObjectCallbackSpec =
    | OwnerQualifiedOptionObjectCallbackSpec
    | ModuleSemanticOptionObjectCallbackSpec;

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

const OPTION_OBJECT_CALLBACK_SPECS: OptionObjectCallbackSpec[] = [
    {
        kind: "owner_qualified",
        ownerClassNames: new Set(["CustomDialogController"]),
        methodNames: new Set(["constructor"]),
        optionsArgIndex: 0,
        callbackFieldNames: new Set(["builder", "cancel", "confirm"]),
        reasonLabel: "Framework controller callback registration",
    },
    {
        kind: "module_semantic",
        methodNames: new Set(["animateTo"]),
        optionsArgIndex: 0,
        callbackFieldNames: new Set(["onFinish"]),
        requiredFieldNames: new Set(["duration"]),
        reasonLabel: "Framework module callback registration",
    },
    {
        kind: "owner_qualified",
        ownerClassNames: new Set(["MethodChannel"]),
        methodNames: new Set(["setMethodCallHandler"]),
        optionsArgIndex: 0,
        callbackFieldNames: new Set(["onMethodCall"]),
        reasonLabel: "Flutter MethodChannel callback registration",
    },
];

export function resolveKnownOptionCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: any,
): KnownOptionCallbackRegistrationMatch[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const methodSig = invokeExpr.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, KnownOptionCallbackRegistrationMatch>();

    for (const componentBinding of resolveComponentPropertyCallbackInvocationsFromStmt(stmt, scene, sourceMethod, invokeExpr)) {
        const callbackSignature = componentBinding.callbackMethod.getSignature?.()?.toString?.() || "";
        const key = `${callbackSignature}|component:${componentBinding.registrationOwnerName}.${componentBinding.registrationMethodName}`;
        if (!callbackSignature || out.has(key)) continue;
        out.set(key, componentBinding);
    }

    for (const componentBinding of resolveDirectProjectComponentOptionCallbacksFromStmt(stmt, scene, sourceMethod, invokeExpr)) {
        const callbackSignature = componentBinding.callbackMethod.getSignature?.()?.toString?.() || "";
        const key = `${callbackSignature}|project-component:${componentBinding.registrationOwnerName}.${componentBinding.registrationMethodName}`;
        if (!callbackSignature || out.has(key)) continue;
        out.set(key, componentBinding);
    }

    for (const webJsBinding of resolveWebJavaScriptProxyCallbacksFromStmt(stmt, scene, sourceMethod, invokeExpr)) {
        const callbackSignature = webJsBinding.callbackMethod.getSignature?.()?.toString?.() || "";
        const key = `${callbackSignature}|web-js-proxy:${webJsBinding.callbackFieldName || ""}`;
        if (!callbackSignature || out.has(key)) continue;
        out.set(key, webJsBinding);
    }

    for (const spec of OPTION_OBJECT_CALLBACK_SPECS) {
        if (!matchesOptionObjectCallbackSpec(spec, stmt, scene, sourceMethod, invokeExpr, methodName, className)) {
            continue;
        }

        const optionsValue = explicitArgs[spec.optionsArgIndex];
        if (!optionsValue) continue;

        for (const fieldName of spec.callbackFieldNames) {
            const callbackMethods = resolveMethodsFromAnonymousObjectCarrierByField(scene, optionsValue, fieldName);
            for (const callbackMethod of callbackMethods) {
                if (!callbackMethod?.getCfg?.()) continue;
                const callbackSignature = callbackMethod.getSignature?.()?.toString?.() || "";
                if (!callbackSignature) continue;
                const registrationSignature = methodSig?.toString?.() || "";
                const key = `${callbackSignature}|field:${fieldName}|call:${registrationSignature}`;
                if (out.has(key)) continue;
                out.set(key, {
                    callbackMethod,
                    sourceMethod,
                    registrationMethod: sourceMethod,
                    registrationInvokeExpr: invokeExpr,
                    registrationMethodName: methodName,
                    registrationOwnerName: className,
                    registrationSignature,
                    callbackArgIndex: spec.optionsArgIndex,
                    callbackFieldName: fieldName,
                    reason: `${spec.reasonLabel} ${className}.${fieldName} from ${sourceMethod.getName?.() || ""}`.trim(),
                    callbackFlavor: "channel",
                    registrationShape: "options_object_slot",
                    slotFamily: "controller_option_slot",
                    recognitionLayer: "controller_options",
                });
            }
        }
    }

    return [...out.values()];
}

function resolveWebJavaScriptProxyCallbacksFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): KnownOptionCallbackRegistrationMatch[] {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "javaScriptProxy") return [];

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const optionsValue = explicitArgs[0];
    if (!optionsValue) return [];

    const objectValues = collectAnonymousObjectFieldValues(scene, optionsValue, "object");
    if (objectValues.length === 0) return [];

    const methodNames = new Set<string>();
    for (const candidate of collectAnonymousObjectStringFieldCandidates(scene, optionsValue, "methodList")) {
        if (isValidJavaScriptProxyMethodName(candidate)) {
            methodNames.add(candidate);
        }
    }
    if (methodNames.size === 0) return [];

    const registrationSignature = methodSig?.toString?.() || "";
    const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const out = new Map<string, KnownOptionCallbackRegistrationMatch>();
    for (const objectValue of objectValues) {
        for (const methodListName of [...methodNames].sort((a, b) => a.localeCompare(b))) {
            for (const callbackMethod of resolveObjectMethodByName(scene, sourceMethod, objectValue, methodListName)) {
                if (!callbackMethod?.getCfg?.()) continue;
                const callbackSignature = callbackMethod.getSignature?.()?.toString?.() || "";
                if (!callbackSignature) continue;
                const key = `${callbackSignature}|${methodListName}`;
                if (out.has(key)) continue;
                out.set(key, {
                    callbackMethod,
                    sourceMethod,
                    registrationMethod: sourceMethod,
                    registrationInvokeExpr: invokeExpr,
                    registrationMethodName: methodName,
                    registrationOwnerName: ownerName,
                    registrationSignature,
                    callbackArgIndex: 0,
                    callbackFieldName: methodListName,
                    reason: `Web javaScriptProxy callback ${methodListName} from ${sourceMethod.getName?.() || ""}`.trim(),
                    callbackFlavor: "channel",
                    registrationShape: "options_object_slot",
                    slotFamily: "web_js_proxy_slot",
                    recognitionLayer: "web_js_proxy_options",
                });
            }
        }
    }
    return [...out.values()];
}

function isValidJavaScriptProxyMethodName(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(name || ""));
}

function collectAnonymousObjectFieldValues(scene: Scene, objectValue: any, fieldName: string): any[] {
    const classSig = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        if (methodDeclaringClassSignatureText(method) !== classSig) continue;
        const methodName = method?.getName?.() || "";
        if (!(methodName.includes("constructor(") || methodName.includes("%instInit"))) continue;
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
        const methodName = method?.getName?.() || "";
        if (!(methodName.includes("constructor(") || methodName.includes("%instInit"))) continue;
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

const OFFICIAL_ARKUI_COMPONENT_FACTORY_NAMES = new Set([
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

function resolveDirectProjectComponentOptionCallbacksFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): KnownOptionCallbackRegistrationMatch[] {
    if (!isArkUiCompositionSourceMethod(sourceMethod)) return [];
    const componentName = resolveProjectComponentFactoryName(invokeExpr, stmt);
    if (!componentName) return [];

    const optionsValue = invokeExpr.getArgs?.()?.[0];
    if (!optionsValue) return [];

    const callbackFieldNames = collectAnonymousObjectOnCallbackFieldNames(scene, optionsValue);
    if (callbackFieldNames.length === 0) return [];

    const out: KnownOptionCallbackRegistrationMatch[] = [];
    const registrationSignature = invokeExpr?.getMethodSignature?.()?.toString?.() || `component:${componentName}`;
    for (const fieldName of callbackFieldNames) {
        const callbackMethods = resolveMethodsFromAnonymousObjectCarrierByField(scene, optionsValue, fieldName, {
            maxCandidates: 16,
            enableLocalBacktrace: true,
            maxBacktraceSteps: 6,
            maxVisitedDefs: 24,
        }).filter(method => !!method?.getCfg?.());
        for (const callbackMethod of callbackMethods) {
            out.push({
                callbackMethod,
                sourceMethod,
                registrationMethod: sourceMethod,
                registrationInvokeExpr: invokeExpr,
                registrationMethodName: componentName,
                registrationOwnerName: componentName,
                registrationSignature,
                callbackArgIndex: 0,
                callbackFieldName: fieldName,
                reason: `Project component option callback ${componentName}.${fieldName} from ${sourceMethod.getName?.() || ""}`.trim(),
                callbackFlavor: "ui_event",
                registrationShape: "options_object_slot",
                slotFamily: "project_component_option_slot",
                recognitionLayer: "component_options",
            });
        }
    }
    return out;
}

function isArkUiCompositionSourceMethod(method: any): boolean {
    const cls = method?.getDeclaringArkClass?.();
    if (isArkUiComponentClass(cls)) return true;
    return hasDecorator(method, "Builder");
}

function hasDecorator(owner: any, expected: string): boolean {
    return (owner?.getDecorators?.() || []).some((decorator: any) =>
        normalizeDecoratorKind(decorator?.getKind?.()) === expected,
    );
}

function resolveProjectComponentFactoryName(invokeExpr: any, stmt: any): string | undefined {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const candidate = methodName === "constructor" ? className : methodName;
    if (!isProjectComponentFactoryName(candidate)) return undefined;
    if (OFFICIAL_ARKUI_COMPONENT_FACTORY_NAMES.has(candidate)) return undefined;

    const stmtText = String(stmt?.toString?.() || "");
    if (methodName === "constructor") return candidate;
    if (stmtText.includes(`.${candidate}(`) || stmtText.includes(` ${candidate}(`) || stmtText.includes(`${candidate}(`)) {
        return candidate;
    }
    return candidate;
}

function isProjectComponentFactoryName(name: string): boolean {
    if (!/^[A-Z][A-Za-z0-9_$]*$/.test(name)) return false;
    if (name.startsWith("%")) return false;
    return !["Array", "Date", "Error", "Map", "Object", "Promise", "RegExp", "Set", "String", "Number", "Boolean"].includes(name);
}

function collectAnonymousObjectOnCallbackFieldNames(scene: Scene, objectValue: any): string[] {
    const classSig = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out = new Set<string>();
    for (const method of scene.getMethods()) {
        if (methodDeclaringClassSignatureText(method) !== classSig) continue;
        const methodName = method?.getName?.() || "";
        const fieldFromMethod = extractOnCallbackFieldNameFromAnonymousCarrierMethod(methodName);
        if (fieldFromMethod) {
            out.add(fieldFromMethod);
        }
        if (!(methodName.includes("constructor(") || methodName.includes("%instInit"))) continue;
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const anyStmt = stmt as any;
            const left = anyStmt?.getLeftOp?.();
            const base = left?.getBase?.();
            const fieldName = left?.getFieldSignature?.()?.getFieldName?.() || "";
            if (base?.getName?.() !== "this" || !isOnCallbackFieldName(fieldName)) continue;
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

function extractOnCallbackFieldNameFromAnonymousCarrierMethod(methodName: string): string | undefined {
    const parts = String(methodName || "").split("$").filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index--) {
        const candidate = parts[index].replace(/[()<>]/g, "");
        if (isOnCallbackFieldName(candidate)) return candidate;
    }
    return isOnCallbackFieldName(methodName) ? methodName : undefined;
}

function isOnCallbackFieldName(name: string): boolean {
    return /^on[A-Z][A-Za-z0-9_$]*$/.test(String(name || ""));
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

    const componentName = String(componentClass.getName?.() || "");
    if (!componentName) return [];

    const callbackMethods = resolveComponentFactoryCallbacks(scene, componentName, fieldName)
        .filter(method => !!method?.getCfg?.());
    const out: KnownOptionCallbackRegistrationMatch[] = [];
    const registrationSignature = invokeExpr?.getMethodSignature?.()?.toString?.() || `component:${componentName}.${fieldName}`;
    for (const callbackMethod of callbackMethods) {
        out.push({
            callbackMethod,
            sourceMethod,
            registrationMethod: sourceMethod,
            registrationInvokeExpr: invokeExpr,
            registrationMethodName: fieldName,
            registrationOwnerName: componentName,
            registrationSignature,
            callbackArgIndex: 0,
            callbackFieldName: fieldName,
            reason: `ArkUI component property callback ${componentName}.${fieldName}`,
            callbackFlavor: "channel",
            registrationShape: "options_object_slot",
            slotFamily: "component_property_slot",
            recognitionLayer: "component_options",
        });
    }
    return out;
}

function resolveThisFieldPtrInvokeName(stmt: any): string | undefined {
    const text = String(stmt?.toString?.() || "");
    const match = text.match(/\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*</);
    return match?.[1];
}

function resolveComponentFactoryCallbacks(scene: Scene, componentName: string, fieldName: string): any[] {
    let sceneCache = componentPropertyCallbackCache.get(scene);
    if (!sceneCache) {
        sceneCache = new Map<string, any[]>();
        componentPropertyCallbackCache.set(scene, sceneCache);
    }
    const cacheKey = `${componentName}.${fieldName}`;
    const cached = sceneCache.get(cacheKey);
    if (cached) return cached;

    const out = new Map<string, any>();
    const addFromStmt = (stmt: any): void => {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr || !isComponentFactoryInvoke(invokeExpr, stmt, componentName)) return;
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

function isComponentFactoryInvoke(invokeExpr: any, stmt: any, componentName: string): boolean {
    const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName === componentName) return true;
    const declaringClassName = invokeExpr?.getMethodSignature?.()
        ?.getDeclaringClassSignature?.()
        ?.getClassName?.() || "";
    if (methodName === "constructor" && declaringClassName === componentName) return true;
    const sigText = String(invokeExpr?.getMethodSignature?.()?.toString?.() || "");
    if (sigText.includes(`.${componentName}(`)) return true;
    const stmtText = String(stmt?.toString?.() || "");
    return stmtText.includes(`.${componentName}(`) || stmtText.includes(` ${componentName}(`);
}

function componentClassHasField(cls: any, fieldName: string): boolean {
    return (cls?.getFields?.() || []).some((field: any) => field?.getName?.() === fieldName);
}

function isArkUiComponentClass(cls: any): boolean {
    return (cls?.getDecorators?.() || []).some((decorator: any) => {
        const kind = normalizeDecoratorKind(decorator?.getKind?.());
        return kind === "Entry" || kind === "Component" || kind === "ComponentV2" || kind === "CustomDialog";
    });
}

function normalizeDecoratorKind(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    return normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
}

function matchesOptionObjectCallbackSpec(
    spec: OptionObjectCallbackSpec,
    stmt: any,
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    methodName: string,
    className: string,
): boolean {
    void stmt;
    if (!spec.methodNames.has(methodName)) {
        return false;
    }
    if (spec.kind === "owner_qualified") {
        return !spec.ownerClassNames
            || spec.ownerClassNames.size === 0
            || spec.ownerClassNames.has(className)
            || ownerTypeMatches(invokeExpr, spec.ownerClassNames);
    }
    return matchesModuleSemanticOptionObjectCallbackSpec(spec, scene, sourceMethod, invokeExpr);
}

function ownerTypeMatches(invokeExpr: any, ownerClassNames: Set<string>): boolean {
    const baseTypeText = String(invokeExpr?.getBase?.()?.getType?.()?.toString?.() || "");
    if (!baseTypeText) return false;
    return [...ownerClassNames].some(ownerName =>
        baseTypeText === ownerName
        || baseTypeText.endsWith(`: ${ownerName}`)
        || baseTypeText.includes(`: ${ownerName}|`)
        || baseTypeText.includes(`|${ownerName}`)
        || baseTypeText.includes(` ${ownerName}`),
    );
}

function matchesModuleSemanticOptionObjectCallbackSpec(
    spec: ModuleSemanticOptionObjectCallbackSpec,
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!hasModuleSemanticRegistrationProvenance(scene, sourceMethod, invokeExpr, methodSig)) {
        return false;
    }
    return hasSemanticOptionParameterShape(scene, invokeExpr, spec.optionsArgIndex, {
        callbackFieldNames: spec.callbackFieldNames,
        requiredFieldNames: spec.requiredFieldNames || new Set<string>(),
    });
}

/** True when the callee is SDK-backed, imported into the caller file, or defined in a different file than the caller (module semantic registration). */
export function hasModuleSemanticRegistrationProvenance(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    methodSig: any,
): boolean {
    if (isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr })) {
        return true;
    }

    const sourceFile = sourceMethod?.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || sourceMethod?.getDeclaringArkFile?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const importFrom = sourceFile?.getImportInfoBy?.(methodName)?.getFrom?.() || "";
    if (importFrom) {
        return true;
    }

    const sourceFileSigText = sourceFile?.getFileSignature?.()?.toString?.() || "";
    const resolvedCallees = resolveCalleeCandidates(scene, invokeExpr, { maxNameMatchCandidates: 4 });
    return resolvedCallees.some(resolved => {
        const calleeFileSigText = resolved?.method?.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.()
            || resolved?.method?.getSignature?.()?.getDeclaringClassSignature?.()?.getDeclaringFileSignature?.()?.toString?.()
            || "";
        return !!calleeFileSigText && calleeFileSigText !== sourceFileSigText;
    });
}

function hasSemanticOptionParameterShape(
    scene: Scene,
    invokeExpr: any,
    optionsArgIndex: number,
    contract: {
        callbackFieldNames: Set<string>;
        requiredFieldNames: Set<string>;
    },
): boolean {
    const parameterTypes = collectOptionParameterTypes(scene, invokeExpr, optionsArgIndex);
    return parameterTypes.some(parameterType =>
        optionParameterTypeMatchesContract(scene, parameterType, contract),
    );
}

function collectOptionParameterTypes(scene: Scene, invokeExpr: any, optionsArgIndex: number): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const pushType = (type: any): void => {
        if (!type) return;
        const key = String(type.toString?.() || type.getTypeString?.() || "");
        if (seen.has(key)) return;
        seen.add(key);
        out.push(type);
    };

    const invokeParameters = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getParameters?.() || [];
    const invokeParameter = invokeParameters[optionsArgIndex];
    pushType(invokeParameter?.getType?.());

    const resolvedCallees = resolveCalleeCandidates(scene, invokeExpr, { maxNameMatchCandidates: 4 });
    for (const resolved of resolvedCallees) {
        const parameters = resolved?.method?.getParameters?.() || [];
        const parameter = parameters[optionsArgIndex];
        pushType(parameter?.getType?.());
    }

    return out;
}

function optionParameterTypeMatchesContract(
    scene: Scene,
    parameterType: any,
    contract: {
        callbackFieldNames: Set<string>;
        requiredFieldNames: Set<string>;
    },
): boolean {
    for (const klass of resolveArkClassesFromType(scene, parameterType)) {
        const fields = klass?.getFields?.() || [];
        const fieldMap = new Map<string, any>();
        for (const field of fields) {
            const fieldName = field?.getName?.() || "";
            if (!fieldName || fieldMap.has(fieldName)) continue;
            fieldMap.set(fieldName, field);
        }
        if ([...contract.requiredFieldNames].some(fieldName => !fieldMap.has(fieldName))) {
            continue;
        }
        if ([...contract.callbackFieldNames].some(fieldName => {
            const field = fieldMap.get(fieldName);
            return !field || !isCallableLikeType(field.getType?.());
        })) {
            continue;
        }
        return true;
    }
    return false;
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

function isCallableLikeType(type: any, depth: number = 0): boolean {
    if (!type || depth > 4) {
        return false;
    }
    if (type.getMethodSignature?.()) {
        return true;
    }

    const originalType = type.getOriginalType?.();
    if (originalType && isCallableLikeType(originalType, depth + 1)) {
        return true;
    }

    const unionTypes = type.getTypes?.();
    if (Array.isArray(unionTypes) && unionTypes.some((unionType: any) => isCallableLikeType(unionType, depth + 1))) {
        return true;
    }

    const currType = type.getCurrType?.();
    if (currType && currType !== type && isCallableLikeType(currType, depth + 1)) {
        return true;
    }

    const text = String(type.toString?.() || type.getTypeString?.() || "").toLowerCase();
    return text.includes("=>") || text.includes("function") || text.includes("%am");
}
