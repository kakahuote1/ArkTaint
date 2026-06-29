import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { isSdkBackedMethodSignature } from "../../../substrate/queries/SdkProvenance";
import { resolveCallbackMethodsFromValueWithReturns } from "../../../substrate/queries/CallbackBindingQuery";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { dedupeMethods } from "./ArkMainFactResolverUtils";

const MAX_WRAPPED_BUILDER_RESOLVE_DEPTH = 6;

export function collectBuilderNodeBuildFacts(
    scene: Scene,
    context: ArkMainFactCollectionContext,
): void {
    const initialCandidateMethods = dedupeMethods([
        ...context.explicitSeedMethods,
        ...context.phaseCandidateMethods.get("bootstrap")!,
        ...context.phaseCandidateMethods.get("composition")!,
        ...context.phaseCandidateMethods.get("interaction")!,
        ...context.phaseCandidateMethods.get("reactive_handoff")!,
        ...context.phaseCandidateMethods.get("teardown")!,
    ]);
    const pendingMethods = [...initialCandidateMethods];
    const queuedSignatures = new Set(
        initialCandidateMethods
            .map(method => method.getSignature?.()?.toString?.())
            .filter((signature): signature is string => !!signature),
    );
    const scannedSignatures = new Set<string>();

    for (let head = 0; head < pendingMethods.length; head++) {
        const sourceMethod = pendingMethods[head];
        const sourceSignature = sourceMethod.getSignature?.()?.toString?.();
        if (!sourceSignature || scannedSignatures.has(sourceSignature)) {
            continue;
        }
        scannedSignatures.add(sourceSignature);

        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of [
            ...cfg.getStmts(),
            ...collectDeclaringClassInitializerStmts(sourceMethod),
        ]) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!isSdkBuilderNodeBuildInvocation(scene, sourceMethod, invokeExpr)) {
                continue;
            }
            const explicitArgs = invokeExpr.getArgs?.() || [];
            const wrappedBuilderValue = explicitArgs[0];
            if (!wrappedBuilderValue) {
                continue;
            }
            const callbacks = resolveWrappedBuilderCallbackMethods(
                scene,
                sourceMethod,
                wrappedBuilderValue,
                0,
                new Set<string>(),
            );
            for (const callbackMethod of callbacks) {
                const callbackSignature = callbackMethod.getSignature?.()?.toString?.();
                if (!callbackSignature) continue;
                const factCountBefore = context.facts.length;
                context.addFact({
                    phase: "composition",
                    kind: "callback",
                    method: callbackMethod,
                    reason: "SDK ArkMain BuilderNode.build WrappedBuilder callback",
                    sourceMethod,
                    callbackFlavor: "channel",
                    callbackShape: "wrapped_builder_slot",
                    callbackSlotFamily: "builder_node_build_slot",
                    callbackRecognitionLayer: "sdk_provenance",
                    callbackRegistrationSignature: invokeExpr.getMethodSignature?.()?.toString?.() || "",
                    callbackArgIndex: 0,
                    entryFamily: "builder_node_build_slot",
                    entryShape: "wrapped_builder_slot",
                    recognitionLayer: "sdk_provenance",
                });
                if (context.facts.length === factCountBefore || queuedSignatures.has(callbackSignature)) {
                    continue;
                }
                queuedSignatures.add(callbackSignature);
                context.addPhaseCandidateMethod("composition", callbackMethod);
                pendingMethods.push(callbackMethod);
            }
        }
    }
}

function resolveWrappedBuilderCallbackMethods(
    scene: Scene,
    sourceMethod: ArkMethod,
    value: any,
    depth: number,
    visited: Set<string>,
): ArkMethod[] {
    if (!value || depth > MAX_WRAPPED_BUILDER_RESOLVE_DEPTH) {
        return [];
    }

    const visitKey = valueIdentity(value);
    if (visitKey) {
        if (visited.has(visitKey)) {
            return [];
        }
        visited.add(visitKey);
    }

    const out: ArkMethod[] = [];
    const invokeExpr = extractInvokeExpr(value);
    if (
        isSdkWrapBuilderInvocation(scene, sourceMethod, invokeExpr)
        || isSdkWrappedBuilderConstructorInvocation(scene, sourceMethod, invokeExpr)
    ) {
        const builderArg = invokeExpr.getArgs?.()?.[0];
        out.push(...resolveCallbackMethodsFromValueWithReturns(scene, builderArg, {
            maxDepth: 4,
        }).filter(method => !!method?.getCfg?.()));
    }

    const localConstructorInvoke = findSdkWrappedBuilderConstructorInvokeForLocal(scene, sourceMethod, value);
    if (localConstructorInvoke) {
        const builderArg = localConstructorInvoke.getArgs?.()?.[0];
        out.push(...resolveCallbackMethodsFromValueWithReturns(scene, builderArg, {
            maxDepth: 4,
        }).filter(method => !!method?.getCfg?.()));
    }

    const rightOp = value?.getDeclaringStmt?.()?.getRightOp?.();
    if (rightOp && rightOp !== value) {
        out.push(...resolveWrappedBuilderCallbackMethods(
            scene,
            sourceMethod,
            rightOp,
            depth + 1,
            visited,
        ));
    }

    return dedupeMethods(out);
}

function isSdkBuilderNodeBuildInvocation(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!methodSig || !isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr })) {
        return false;
    }
    const ownerName = methodSig.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
    return ownerName === "BuilderNode" && methodName === "build";
}

function isSdkWrapBuilderInvocation(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!methodSig || !isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr })) {
        return false;
    }
    const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
    return methodName === "wrapBuilder";
}

function isSdkWrappedBuilderConstructorInvocation(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!methodSig || !isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr })) {
        return false;
    }
    const ownerName = methodSig.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
    return ownerName === "WrappedBuilder" && (methodName === "constructor" || methodName === "%instInit");
}

function findSdkWrappedBuilderConstructorInvokeForLocal(
    scene: Scene,
    sourceMethod: ArkMethod,
    value: any,
): any {
    const localName = value?.getName?.();
    if (!localName) {
        return undefined;
    }
    const cfg = sourceMethod.getCfg?.();
    if (!cfg) {
        return undefined;
    }
    for (const stmt of cfg.getStmts?.() || []) {
        const stmtAny = stmt as any;
        const leftName = stmtAny?.getLeftOp?.()?.getName?.();
        if (leftName !== localName) {
            continue;
        }
        const invokeExpr = stmtAny?.getInvokeExpr?.() || stmtAny?.getRightOp?.();
        if (isSdkWrappedBuilderConstructorInvocation(scene, sourceMethod, invokeExpr)) {
            return invokeExpr;
        }
    }
    return undefined;
}

function extractInvokeExpr(value: any): any {
    if (value?.getMethodSignature?.()) {
        return value;
    }
    const declaringStmt = value?.getDeclaringStmt?.();
    const stmtInvoke = declaringStmt?.getInvokeExpr?.();
    if (stmtInvoke?.getMethodSignature?.()) {
        return stmtInvoke;
    }
    const rightOp = declaringStmt?.getRightOp?.();
    if (rightOp?.getMethodSignature?.()) {
        return rightOp;
    }
    const rightInvoke = rightOp?.getInvokeExpr?.();
    return rightInvoke?.getMethodSignature?.() ? rightInvoke : undefined;
}

function collectDeclaringClassInitializerStmts(method: any): any[] {
    const cls = method?.getDeclaringArkClass?.();
    const fields = cls?.getFields?.() || [];
    const out: any[] = [];
    for (const field of fields) {
        const initializer = field?.getInitializer?.();
        if (Array.isArray(initializer)) {
            out.push(...initializer);
        } else if (initializer) {
            out.push(initializer);
        }
    }
    return out;
}

function valueIdentity(value: any): string | undefined {
    const stmt = value?.getDeclaringStmt?.();
    return [
        value?.getName?.() || value?.toString?.() || "",
        stmt?.getOriginPositionInfo?.()?.toString?.() || "",
        stmt?.toString?.() || "",
    ].filter(Boolean).join("|") || undefined;
}
