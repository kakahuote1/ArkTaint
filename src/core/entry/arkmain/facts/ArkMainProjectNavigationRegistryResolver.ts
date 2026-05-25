import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { resolveCallbackMethodsFromValueWithReturns } from "../../../substrate/queries/CallbackBindingQuery";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";

const REGISTRATION_METHOD_NAMES = new Set([
    "register",
    "setBuilder",
    "setDestinationBuilder",
    "registerBuilder",
]);

export function collectProjectNavigationRegistryFacts(
    scene: Scene,
    context: ArkMainFactCollectionContext,
): void {
    if (!hasNavigationDestinationConsumer(scene)) {
        return;
    }

    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const localBuilderCallbacks = collectLocalBuilderCallbackBindings(scene, method);
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr || !isProjectNavigationRegistryRegistration(method, invokeExpr)) {
                continue;
            }
            const callbacks = collectRegisteredBuilderCallbacks(scene, invokeExpr, localBuilderCallbacks);
            for (const callback of callbacks) {
                if (!isNavigationBuilderEntrypoint(callback)) {
                    continue;
                }
                const signature = callback.getSignature?.()?.toString?.();
                if (!signature || seen.has(signature)) {
                    continue;
                }
                seen.add(signature);
                context.addFact({
                    phase: "composition",
                    kind: "page_build",
                    method: callback,
                    ownerKind: "builder_owner",
                    reason: `Project navigation registry exposes builder ${callback.getName?.() || "<builder>"}`,
                    sourceMethod: method,
                    entryFamily: "navigation_destination_builder",
                    entryShape: "project_route_registry_builder",
                    recognitionLayer: "project_navigation_registry",
                });
                context.addPhaseCandidateMethod("composition", callback);
            }
        }
    }
}

function hasNavigationDestinationConsumer(scene: Scene): boolean {
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            const methodName = invokeExpr?.getMethodSignature?.()
                ?.getMethodSubSignature?.()
                ?.getMethodName?.() || "";
            if (methodName === "navDestination") {
                return true;
            }
            const text = String(stmt?.toString?.() || "");
            if (/\bnavDestination\s*\(/.test(text)) {
                return true;
            }
        }
    }
    return false;
}

function collectLocalBuilderCallbackBindings(
    scene: Scene,
    method: ArkMethod,
): Map<string, ArkMethod[]> {
    const out = new Map<string, ArkMethod[]>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr || !isBuilderWrapperInvoke(invokeExpr)) {
            continue;
        }
        const leftName = (stmt as any)?.getLeftOp?.()?.getName?.();
        if (!leftName) {
            continue;
        }
        const args = invokeExpr.getArgs?.() || [];
        const callbackValue = args[0];
        if (!callbackValue) {
            continue;
        }
        const callbacks = resolveCallbackMethodsFromValueWithReturns(scene, callbackValue, { maxDepth: 4 });
        if (callbacks.length > 0) {
            out.set(leftName, callbacks);
        }
    }
    return out;
}

function isBuilderWrapperInvoke(invokeExpr: any): boolean {
    const methodName = invokeExpr?.getMethodSignature?.()
        ?.getMethodSubSignature?.()
        ?.getMethodName?.() || "";
    if (/wrapBuilder|builder/i.test(methodName)) {
        return true;
    }
    const signature = String(invokeExpr?.getMethodSignature?.()?.toString?.() || "");
    return /wrapBuilder|builder/i.test(signature);
}

function isProjectNavigationRegistryRegistration(method: ArkMethod, invokeExpr: any): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (!REGISTRATION_METHOD_NAMES.has(methodName)) {
        return false;
    }
    const declaringClassName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const sourceClassName = method.getDeclaringArkClass?.()?.getName?.() || "";
    const nameText = [declaringClassName, methodName, sourceClassName].join(" ").toLowerCase();
    return /\b(route|router|nav|navigation)\b/i.test(nameText)
        || /(route|router|nav|navigation)/i.test(declaringClassName);
}

function collectRegisteredBuilderCallbacks(
    scene: Scene,
    invokeExpr: any,
    localBuilderCallbacks: Map<string, ArkMethod[]>,
): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    const args = invokeExpr.getArgs?.() || [];
    for (let index = 1; index < args.length; index++) {
        const arg = args[index];
        const localName = arg?.getName?.();
        const localCallbacks = localName ? localBuilderCallbacks.get(localName) || [] : [];
        const directCallbacks = resolveCallbackMethodsFromValueWithReturns(scene, arg, { maxDepth: 4 });
        for (const callback of [...localCallbacks, ...directCallbacks]) {
            const signature = callback.getSignature?.()?.toString?.();
            if (signature && !out.has(signature)) {
                out.set(signature, callback);
            }
        }
    }
    return [...out.values()];
}

function isNavigationBuilderEntrypoint(method: ArkMethod): boolean {
    if (hasBuilderDecorator(method)) {
        return true;
    }
    const signatureText = String(method.getSignature?.()?.toString?.() || "").replace(/\\/g, "/");
    if (/(^|\/)navigation\//i.test(signatureText) && /Nav(?:\(|$)/.test(method.getName?.() || "")) {
        return true;
    }
    const code = String(method.getCode?.() || "");
    return /\b[A-Z][A-Za-z0-9_$]*\s*\(/.test(code);
}

function hasBuilderDecorator(method: ArkMethod): boolean {
    return (method.getDecorators?.() || []).some((decorator: any) => {
        const kind = String(decorator?.getKind?.() || decorator?.toString?.() || "")
            .replace(/^@/, "")
            .replace(/\(\)$/, "")
            .trim();
        return kind === "Builder";
    });
}
