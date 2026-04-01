import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { collectParameterAssignStmts, isCallableValue, resolveMethodsFromCallable } from "../../substrate/queries/CalleeResolver";
import { recoverEventRegistrationSemantics } from "../model/EventRegistrationSemantics";
import { recoverDeferredCompletionSemantics } from "../model/DeferredCompletionSemantics";
import {
    resolveCallbackMethodsFromValueWithReturns,
    resolveCallbackRegistrationsFromStmt,
} from "../../substrate/queries/CallbackBindingQuery";
import {
    ExecutionHandoffContinuationRole,
    ExecutionHandoffActivationPathRecord,
    ExecutionHandoffFeatures,
    ExecutionHandoffRecoveredSemanticsRecord,
    HandoffActivationLabel,
    HandoffCarrierKind,
    HandoffPathLabel,
    HandoffResumeKind,
    HandoffTriggerToken,
} from "./ExecutionHandoffContract";

const CALLBACK_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
} as const;

interface IncomingCallSite {
    callStmt: any;
    args?: any[];
}

interface ExecutionHandoffProvenanceContext {
    incomingCallsiteIndexByCalleeSig?: Map<string, IncomingCallSite[]>;
}

interface ExecutionHandoffCandidate {
    unit: any;
    sourceMethods: any[];
    carrierKinds: Set<HandoffCarrierKind>;
}

interface RelayOrigin {
    method: any;
    sourceMethod: any;
    carrierKind: HandoffCarrierKind;
}

interface RecoveredExecutionHandoffSemantics {
    activationLabel: HandoffActivationLabel;
    semantics: ExecutionHandoffRecoveredSemanticsRecord;
}

export function buildExecutionHandoffActivationPaths(
    scene: Scene,
    cg: CallGraph,
): ExecutionHandoffActivationPathRecord[] {
    const context: ExecutionHandoffProvenanceContext = {
        incomingCallsiteIndexByCalleeSig: buildIncomingCallsiteIndex(scene, cg),
    };
    const records = new Map<string, ExecutionHandoffActivationPathRecord>();

    for (const caller of scene.getMethods()) {
        const cfg = caller.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            for (const candidate of collectFutureUnitCandidates(scene, caller, stmt, context)) {
                const record = buildExecutionHandoffActivationPathRecord(scene, caller, stmt, candidate, context);
                if (!record) continue;
                records.set(record.id, record);
            }
        }
    }

    return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function buildExecutionHandoffActivationPathRecord(
    scene: Scene,
    caller: any,
    stmt: any,
    candidate: ExecutionHandoffCandidate,
    context: ExecutionHandoffProvenanceContext,
): ExecutionHandoffActivationPathRecord | undefined {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return undefined;

    const unit = candidate.unit;
    const features = collectExecutionHandoffFeatures(scene, caller, stmt, unit, context);
    const recovered = deriveRecoveredSemantics(features);
    const activationLabel = recovered.activationLabel;
    const carrierKind = deriveCarrierKind(features, candidate.carrierKinds);
    const pathLabels = buildPathLabels(features, activationLabel, carrierKind);
    const callerSignature = methodSignature(caller);
    const unitSignature = methodSignature(unit);
    const lineNo = stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0;

    return {
        id: `${callerSignature}#${lineNo}#${unitSignature}`,
        caller,
        stmt,
        invokeExpr,
        unit,
        sourceMethods: [...candidate.sourceMethods],
        callerSignature,
        unitSignature,
        lineNo,
        carrierKind,
        activationLabel,
        pathLabels,
        hasResumeAnchor: features.hasAwaitResume,
        semantics: recovered.semantics,
        ...features,
    };
}

function collectExecutionHandoffFeatures(
    scene: Scene,
    caller: any,
    stmt: any,
    unit: any,
    context: ExecutionHandoffProvenanceContext,
): ExecutionHandoffFeatures {
    const invokeExpr = stmt?.getInvokeExpr?.();
    const explicitArgs = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const { callableArgIndexes, matchingArgIndexes } = collectArgMatchIndexes(scene, stmt, unit);
    const registrationMatch = invokeExpr
        ? resolveStructuralRegistrationMatch(scene, caller, invokeExpr, explicitArgs)
        : undefined;
    const callbackArgIndexes = inferRegistrationArgIndexes(
        scene,
        caller,
        invokeExpr,
        explicitArgs,
        callableArgIndexes,
        registrationMatch?.callbackArgIndexes || [],
    );
    const localRegistration = callbackArgIndexes.some(index => matchingArgIndexes.includes(index));

    let registrationReachabilityDepth: number | null = localRegistration ? 0 : null;
    if (registrationReachabilityDepth === null && callbackArgIndexes.length > 0) {
        for (const callbackArgIndex of callbackArgIndexes) {
            const paramIndex = resolveParameterIndexForActualArg(caller, explicitArgs[callbackArgIndex]);
            if (paramIndex === null) continue;
            const relayDepth = resolveRelayRegistrationDepth(scene, caller, paramIndex, unit, context);
            if (relayDepth !== null && (registrationReachabilityDepth === null || relayDepth < registrationReachabilityDepth)) {
                registrationReachabilityDepth = relayDepth;
            }
        }
    }

    return {
        invokeText: stmt.toString?.() || "",
        invokeName: invokeMethodName(stmt),
        matchingArgIndexes,
        callableArgIndexes,
        localRegistration,
        registrationReachabilityDepth,
        usesPtrInvoke: String(stmt.toString?.() || "").includes("ptrinvoke "),
        hasAwaitResume: methodStmtTexts(caller).some(text => text.includes("await ")),
        payloadPorts: countPayloadPorts(unit),
        capturePorts: countCapturePorts(unit),
    };
}

function collectFutureUnitCandidates(
    scene: Scene,
    caller: any,
    stmt: any,
    context: ExecutionHandoffProvenanceContext,
): ExecutionHandoffCandidate[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const out = new Map<string, ExecutionHandoffCandidate>();
    const addMethod = (method: any, sourceMethod: any, carrierKind: HandoffCarrierKind): void => {
        const signature = methodSignature(method);
        if (!signature || !method?.getCfg?.()) return;
        if (!out.has(signature)) {
            out.set(signature, {
                unit: method,
                sourceMethods: [],
                carrierKinds: new Set<HandoffCarrierKind>(),
            });
        }
        const candidate = out.get(signature)!;
        if (sourceMethod && !candidate.sourceMethods.some(item => methodSignature(item) === methodSignature(sourceMethod))) {
            candidate.sourceMethods.push(sourceMethod);
        }
        candidate.carrierKinds.add(carrierKind);
    };
    const addMethodsFromValue = (value: any): void => {
        if (!value) return;
        for (const method of resolveCallbackMethodsFromValueWithReturns(scene, value, { maxDepth: 6 })) {
            addMethod(method, caller, "returned");
        }
        for (const method of resolveMethodsFromCallable(scene, value, CALLBACK_RESOLVE_OPTIONS)) {
            addMethod(method, caller, "direct");
        }
    };

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of explicitArgs) {
        addMethodsFromValue(arg);
    }

    const base = invokeExpr.getBase?.();
    if (base && (isCallableValue(base) || String(stmt.toString?.() || "").includes("ptrinvoke "))) {
        addMethodsFromValue(base);
    }

    const registrations = resolveCallbackRegistrationsFromStmt(
        stmt,
        scene,
        caller,
        args => resolveStructuralRegistrationMatch(args.scene, args.sourceMethod, args.invokeExpr, args.explicitArgs),
        { maxDepth: 4 },
    );
    for (const registration of registrations) {
        addMethod(
            registration.callbackMethod,
            registration.sourceMethod || caller,
            registration.sourceMethod && methodSignature(registration.sourceMethod) !== methodSignature(caller) ? "relay" : "direct",
        );
    }

    const registrationMatch = resolveStructuralRegistrationMatch(scene, caller, invokeExpr, explicitArgs);
    const callbackArgIndexes = inferRegistrationArgIndexes(
        scene,
        caller,
        invokeExpr,
        explicitArgs,
        explicitArgs
            .map((arg, index) => ({ arg, index }))
            .filter(item => {
                const methods = resolveMethodsFromCallable(scene, item.arg, CALLBACK_RESOLVE_OPTIONS);
                return methods.length > 0 || isCallableValue(item.arg);
            })
            .map(item => item.index),
        registrationMatch?.callbackArgIndexes || [],
    );
    for (const callbackArgIndex of callbackArgIndexes) {
        const callbackValue = explicitArgs[callbackArgIndex];
        for (const origin of resolveRelayCallbackOrigins(scene, caller, callbackValue, context)) {
            addMethod(origin.method, origin.sourceMethod, origin.carrierKind);
        }
    }

    return [...out.values()];
}

function resolveRelayCallbackOrigins(
    scene: Scene,
    carrierMethod: any,
    value: any,
    context: ExecutionHandoffProvenanceContext,
    visited: Set<string> = new Set<string>(),
): RelayOrigin[] {
    const direct = resolveCallbackMethodsFromValueWithReturns(scene, value, { maxDepth: 6 });
    if (direct.length > 0) {
        return direct.map(method => ({
            method,
            sourceMethod: carrierMethod,
            carrierKind: "returned",
        }));
    }

    const paramIndex = resolveParameterIndexForActualArg(carrierMethod, value);
    if (paramIndex === null) {
        return [];
    }

    const carrierSignature = methodSignature(carrierMethod);
    const visitKey = `${carrierSignature}#${paramIndex}`;
    if (visited.has(visitKey)) {
        return [];
    }
    visited.add(visitKey);

    const out = new Map<string, RelayOrigin>();
    const incomingCallSites = collectIncomingRelayCallSites(scene, carrierSignature, context);
    for (const callSite of incomingCallSites) {
        const invokeExpr = callSite.callStmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const explicitArgs = callSite.args || (invokeExpr.getArgs ? invokeExpr.getArgs() : []);
        if (paramIndex >= explicitArgs.length) continue;
        const actualArg = explicitArgs[paramIndex];
        const sourceMethod = callSite.callStmt?.getCfg?.()?.getDeclaringMethod?.();
        if (!sourceMethod) continue;
        for (const method of resolveCallbackMethodsFromValueWithReturns(scene, actualArg, { maxDepth: 6 })) {
            out.set(methodSignature(method), { method, sourceMethod, carrierKind: "relay" });
        }
        for (const origin of resolveRelayCallbackOrigins(
            scene,
            sourceMethod,
            actualArg,
            context,
            new Set<string>(visited),
        )) {
            out.set(methodSignature(origin.method), {
                ...origin,
                carrierKind: "relay",
            });
        }
    }

    return [...out.values()];
}

function collectArgMatchIndexes(scene: Scene, stmt: any, unit: any): { callableArgIndexes: number[]; matchingArgIndexes: number[] } {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) {
        return { callableArgIndexes: [], matchingArgIndexes: [] };
    }
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const unitSignature = methodSignature(unit);
    const callableArgIndexes: number[] = [];
    const matchingArgIndexes: number[] = [];
    explicitArgs.forEach((arg: any, index: number) => {
        const methods = resolveMethodsFromCallable(scene, arg, CALLBACK_RESOLVE_OPTIONS);
        if (methods.length > 0 || isCallableValue(arg)) {
            callableArgIndexes.push(index);
        }
        if (methods.some(method => methodSignature(method) === unitSignature)) {
            matchingArgIndexes.push(index);
        }
    });
    return { callableArgIndexes, matchingArgIndexes };
}

function inferRegistrationArgIndexes(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    explicitArgs: any[],
    callableArgIndexes: number[],
    classifiedIndexes: number[],
): number[] {
    if (classifiedIndexes.length > 0) {
        return classifiedIndexes;
    }
    return recoverEventRegistrationSemantics({
        scene,
        sourceMethod,
        invokeExpr,
        explicitArgs,
        callableArgIndexes,
        isDeferredCompletion: !!recoverDeferredCompletionSemantics({
            invokeName: invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || null,
            matchingArgIndexes: callableArgIndexes,
            payloadPorts: 0,
            hasResumeAnchor: false,
        }),
    })?.callbackArgIndexes || [];
}

function resolveStructuralRegistrationMatch(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    explicitArgs: any[],
): { callbackArgIndexes: number[]; reason: string } | null {
    const callableArgIndexes = explicitArgs
        .map((arg, index) => ({ arg, index }))
        .filter(item => {
            if (isCallableValue(item.arg)) {
                return true;
            }
            const callbackMethods = resolveCallbackMethodsFromValueWithReturns(scene, item.arg, { maxDepth: 6 });
            if (callbackMethods.length > 0) {
                return true;
            }
            return resolveMethodsFromCallable(scene, item.arg, CALLBACK_RESOLVE_OPTIONS).length > 0;
        })
        .map(item => item.index);

    const registration = recoverEventRegistrationSemantics({
        scene,
        sourceMethod,
        invokeExpr,
        explicitArgs,
        callableArgIndexes,
        isDeferredCompletion: !!recoverDeferredCompletionSemantics({
            invokeName: invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || null,
            matchingArgIndexes: callableArgIndexes,
            payloadPorts: 0,
            hasResumeAnchor: false,
        }),
    });
    if (!registration || registration.callbackArgIndexes.length === 0) {
        return null;
    }

    return registration;
}

function resolveParameterIndexForActualArg(method: any, value: any): number | null {
    if (!(value instanceof Local)) return null;
    for (const binding of collectMethodParameterBindings(method)) {
        if (binding.local === value.getName()) {
            return binding.index;
        }
    }
    return null;
}

function resolveRelayRegistrationDepth(
    scene: Scene,
    calleeMethod: any,
    paramIndex: number,
    unit: any,
    context: ExecutionHandoffProvenanceContext,
    visited: Set<string> = new Set<string>(),
): number | null {
    const calleeSignature = methodSignature(calleeMethod);
    const visitKey = `${calleeSignature}#${paramIndex}`;
    if (visited.has(visitKey)) {
        return null;
    }
    visited.add(visitKey);

    const unitSignature = methodSignature(unit);
    let bestDepth: number | null = null;
    const incomingCallSites = collectIncomingRelayCallSites(scene, calleeSignature, context);

    for (const callSite of incomingCallSites) {
        const callStmt = callSite.callStmt;
        const invokeExpr = callStmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const explicitArgs = callSite.args || (invokeExpr.getArgs ? invokeExpr.getArgs() : []);
        if (paramIndex >= explicitArgs.length) continue;

        const actualArg = explicitArgs[paramIndex];
        const directMethods = resolveCallbackMethodsFromValueWithReturns(scene, actualArg, { maxDepth: 6 });
        if (directMethods.some(method => methodSignature(method) === unitSignature)) {
            bestDepth = bestDepth === null ? 1 : Math.min(bestDepth, 1);
            continue;
        }

        const callerMethod = callStmt?.getCfg?.()?.getDeclaringMethod?.();
        if (!callerMethod) continue;
        const callerParamIndex = resolveParameterIndexForActualArg(callerMethod, actualArg);
        if (callerParamIndex === null) continue;

        const nestedDepth = resolveRelayRegistrationDepth(
            scene,
            callerMethod,
            callerParamIndex,
            unit,
            context,
            new Set<string>(visited),
        );
        if (nestedDepth !== null) {
            const depth = nestedDepth + 1;
            bestDepth = bestDepth === null ? depth : Math.min(bestDepth, depth);
        }
    }

    return bestDepth;
}

function collectIncomingRelayCallSites(
    scene: Scene,
    calleeSignature: string,
    context: ExecutionHandoffProvenanceContext,
): IncomingCallSite[] {
    const indexed = context.incomingCallsiteIndexByCalleeSig?.get(calleeSignature) || [];
    if (indexed.length > 0) {
        return indexed;
    }

    const scanned: IncomingCallSite[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            const invokeSignature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
            if (invokeSignature !== calleeSignature) continue;
            const key = `${methodSignature(method)}#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${stmt.toString?.() || ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            scanned.push({
                callStmt: stmt,
                args: invokeExpr?.getArgs ? invokeExpr.getArgs() : [],
            });
        }
    }
    return scanned;
}

function buildIncomingCallsiteIndex(scene: Scene, cg: CallGraph): Map<string, IncomingCallSite[]> {
    const out = new Map<string, IncomingCallSite[]>();
    const dedup = new Map<string, Set<string>>();

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const callSites = cg.getCallSiteByStmt(stmt) || [];
            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID?.();
                if (calleeFuncID === undefined || calleeFuncID === null) continue;
                const calleeSig = cg.getMethodByFuncID(calleeFuncID)?.toString?.() || "";
                if (!calleeSig) continue;
                const dedupKey = `${cs.callerFuncID || -1}#${calleeFuncID}#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${stmt.toString?.() || ""}`;
                if (!dedup.has(calleeSig)) dedup.set(calleeSig, new Set<string>());
                const seen = dedup.get(calleeSig)!;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);
                if (!out.has(calleeSig)) out.set(calleeSig, []);
                out.get(calleeSig)!.push(cs);
            }
        }
    }

    return out;
}

function countPayloadPorts(method: any): number {
    return collectMethodParameterBindings(method).filter(binding => !binding.local.startsWith("%closures")).length;
}

function countCapturePorts(method: any): number {
    return collectMethodParameterBindings(method).filter(binding => binding.local.startsWith("%closures")).length;
}

function collectMethodParameterBindings(method: any): Array<{ local: string; index: number }> {
    const out: Array<{ local: string; index: number }> = [];
    for (const stmt of collectParameterAssignStmts(method)) {
        const leftOp = stmt?.getLeftOp?.() as any;
        const localName = typeof leftOp?.getName === "function" ? leftOp.getName() : undefined;
        const rightOp = stmt?.getRightOp?.() as any;
        const rawIndex = typeof rightOp?.getIndex === "function" ? rightOp.getIndex() : undefined;
        if (!localName || typeof rawIndex !== "number") continue;
        out.push({ local: localName, index: rawIndex });
    }
    return out;
}

function invokeMethodName(stmt: any): string | null {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return null;
    return invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || null;
}

function methodSignature(method: any): string {
    return method?.getSignature?.()?.toString?.() || method?.getName?.() || "";
}

function methodStmtTexts(method: any): string[] {
    const cfg = method?.getCfg?.();
    if (!cfg) return [];
    return cfg.getStmts().map((stmt: any) => stmt.toString());
}

function deriveRecoveredSemantics(features: ExecutionHandoffFeatures): RecoveredExecutionHandoffSemantics {
    if (features.registrationReachabilityDepth !== null) {
        return buildRecoveredSemantics("register", "event(c)", "none", [], "none");
    }
    const deferredCompletion = recoverDeferredCompletionSemantics({
        invokeName: features.invokeName,
        matchingArgIndexes: features.matchingArgIndexes,
        payloadPorts: features.payloadPorts,
        hasResumeAnchor: features.hasAwaitResume,
    });
    if (deferredCompletion) {
        return buildRecoveredSemantics(
            deferredCompletion.activationLabel,
            deferredCompletion.activation,
            deferredCompletion.completion,
            deferredCompletion.preserve,
            deferredCompletion.continuationRole,
        );
    }
    return buildRecoveredSemantics("invoke", "call(c)", "none", [], "none");
}

function buildRecoveredSemantics(
    activationLabel: HandoffActivationLabel,
    activation: HandoffTriggerToken,
    completion: HandoffResumeKind,
    preserve: HandoffTriggerToken[],
    continuationRole: ExecutionHandoffContinuationRole,
): RecoveredExecutionHandoffSemantics {
    return {
        activationLabel,
        semantics: {
            domain: activation === "call(c)" && completion === "none" ? "control" : "deferred",
            activation,
            completion,
            preserve: [...preserve],
            continuationRole,
        },
    };
}

function deriveCarrierKind(
    features: ExecutionHandoffFeatures,
    carrierKinds: Set<HandoffCarrierKind>,
): HandoffCarrierKind {
    if ((features.registrationReachabilityDepth || 0) > 0 || carrierKinds.has("relay")) {
        return "relay";
    }
    if (carrierKinds.has("returned")) {
        return "returned";
    }
    if (carrierKinds.has("field")) {
        return "field";
    }
    if (carrierKinds.has("slot")) {
        return "slot";
    }
    if (carrierKinds.has("direct") || features.matchingArgIndexes.length > 0 || features.usesPtrInvoke) {
        return "direct";
    }
    return "unknown";
}

function buildPathLabels(
    features: ExecutionHandoffFeatures,
    activationLabel: HandoffActivationLabel,
    carrierKind: HandoffCarrierKind,
): HandoffPathLabel[] {
    const labels: HandoffPathLabel[] = [];
    if (carrierKind === "returned") {
        labels.push("return");
    }
    if (carrierKind === "field") {
        labels.push("load");
    }
    if (carrierKind === "slot") {
        labels.push("load");
    }
    const relayDepth = features.registrationReachabilityDepth || 0;
    if (carrierKind === "relay" || relayDepth > 0) {
        for (let i = 0; i < Math.max(relayDepth, 1); i++) {
            labels.push("pass");
        }
    }
    switch (activationLabel) {
        case "register":
            labels.push("register");
            break;
        case "invoke":
            labels.push("invoke");
            break;
        case "settle_f":
            labels.push("settle_f");
            break;
        case "settle_r":
            labels.push("settle_r");
            break;
        case "settle_a":
            labels.push("settle_a");
            break;
    }
    if (features.hasAwaitResume) {
        labels.push("resume");
    }
    return labels;
}
