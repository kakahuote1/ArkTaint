import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import {
    collectParameterAssignStmts,
    isCallableValue,
    resolveMethodsFromAnonymousObjectCarrierByField,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { recoverDeferredCompletionSemantics } from "../model/DeferredCompletionSemantics";
import type { ModuleExplicitDeferredBindingRecord } from "../model/DeferredBindingDeclaration";
import {
    isKnownFrameworkCallbackMethodName,
    isKnownSchedulerMethodName,
    resolveKnownChannelCallbackRegistration,
    resolveKnownFrameworkCallbackRegistration,
    resolveKnownSchedulerCallbackRegistration,
} from "../../substrate/semantics/ApprovedImperativeDeferredBindingSemantics";
import {
    resolveCallbackMethodsFromValueWithReturns,
    resolveCallbackRegistrationsFromStmt,
} from "../../substrate/queries/CallbackBindingQuery";
import { collectResolvedCallbackBindingsForStmt } from "../builders/SyntheticInvokeCallbacks";
import {
    ExecutionHandoffActivationToken,
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
import {
    collectDeclarativeDeferredBindings,
    type DeclarativeDeferredBindingRecord,
} from "./ExecutionHandoffDeclarativeBinding";
import {
    assertExecutionHandoffBudget,
    ExecutionHandoffBuildBudget,
} from "./ExecutionHandoffBudget";

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
    callbackMethodsWithReturnsByValue: Map<any, any[]>;
    callableMethodsByValue: Map<any, any[]>;
    anonymousCarrierMethodsByBaseAndField: Map<any, Map<string, any[]>>;
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
    explicitBindings: ModuleExplicitDeferredBindingRecord[] = [],
    budget?: ExecutionHandoffBuildBudget,
): ExecutionHandoffActivationPathRecord[] {
    const context: ExecutionHandoffProvenanceContext = {
        incomingCallsiteIndexByCalleeSig: buildIncomingCallsiteIndex(scene, cg, budget),
        callbackMethodsWithReturnsByValue: new Map<any, any[]>(),
        callableMethodsByValue: new Map<any, any[]>(),
        anonymousCarrierMethodsByBaseAndField: new Map<any, Map<string, any[]>>(),
    };
    const records = new Map<string, ExecutionHandoffActivationPathRecord>();

    for (const caller of scene.getMethods()) {
        assertExecutionHandoffBudget(budget, "activation_paths.methods");
        const cfg = caller.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            assertExecutionHandoffBudget(budget, "activation_paths.statements");
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            for (const candidate of collectFutureUnitCandidates(scene, cg, caller, stmt, context, budget)) {
                assertExecutionHandoffBudget(budget, "activation_paths.candidates");
                const record = buildExecutionHandoffActivationPathRecord(scene, caller, stmt, candidate, context);
                if (!record) continue;
                records.set(record.id, record);
            }
        }
    }
    for (const binding of collectDeclarativeDeferredBindings(scene)) {
        assertExecutionHandoffBudget(budget, "activation_paths.declarative_bindings");
        const record = buildDeclarativeExecutionHandoffActivationPathRecord(binding);
        if (!record) continue;
        records.set(record.id, record);
    }
    for (const binding of explicitBindings) {
        assertExecutionHandoffBudget(budget, "activation_paths.explicit_bindings");
        const record = buildExplicitExecutionHandoffActivationPathRecord(binding);
        if (!record) continue;
        records.set(record.id, record);
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
        envSourceMethods: [...candidate.sourceMethods],
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

function buildDeclarativeExecutionHandoffActivationPathRecord(
    binding: DeclarativeDeferredBindingRecord,
): ExecutionHandoffActivationPathRecord | undefined {
    const caller = binding.sourceMethod;
    const stmt = binding.anchorStmt;
    const unit = binding.unit;
    const features = collectDeclarativeExecutionHandoffFeatures(binding);
    const recovered = deriveRecoveredSemantics(features);
    const activationLabel = recovered.activationLabel;
    const carrierKind = deriveCarrierKind(features, new Set<HandoffCarrierKind>(["field"]));
    const pathLabels = buildPathLabels(features, activationLabel, carrierKind);
    const callerSignature = methodSignature(caller);
    const unitSignature = methodSignature(unit);
    const lineNo = stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0;

    return {
        id: `${callerSignature}#${lineNo}#${unitSignature}`,
        caller,
        stmt,
        invokeExpr: undefined,
        unit,
        sourceMethods: [caller],
        envSourceMethods: [caller],
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

function buildExplicitExecutionHandoffActivationPathRecord(
    binding: ModuleExplicitDeferredBindingRecord,
): ExecutionHandoffActivationPathRecord | undefined {
    const caller = binding.sourceMethod;
    const stmt = binding.anchorStmt;
    const unit = binding.unit;
    if (!caller?.getCfg?.() || !unit?.getCfg?.() || !stmt) {
        return undefined;
    }

    const features = collectExplicitExecutionHandoffFeatures(binding);
    const recovered = recoverSemanticsFromExplicitBinding(binding);
    const activationLabel = recovered.activationLabel;
    const carrierKind = binding.carrierKind as HandoffCarrierKind;
    const pathLabels = buildPathLabels(features, activationLabel, carrierKind);
    const callerSignature = methodSignature(caller);
    const unitSignature = methodSignature(unit);
    const lineNo = stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0;

    return {
        id: `${callerSignature}#${lineNo}#${unitSignature}`,
        caller,
        stmt,
        invokeExpr: stmt?.getInvokeExpr?.(),
        unit,
        sourceMethods: [caller],
        envSourceMethods: binding.bindingKind === "declarative"
            ? [...(binding.envSourceMethods || [])]
            : [caller],
        callerSignature,
        unitSignature,
        lineNo,
        carrierKind,
        activationLabel,
        pathLabels,
        hasResumeAnchor: features.hasAwaitResume,
        semantics: recovered.semantics,
        activationSource: binding.bindingKind === "declarative" ? binding.activationSource : undefined,
        payloadSource: binding.bindingKind === "declarative" ? binding.payloadSource : undefined,
        declarativeTriggerLabel: binding.bindingKind === "declarative" ? binding.triggerLabel : undefined,
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
    const { callableArgIndexes, matchingArgIndexes } = collectArgMatchIndexes(scene, stmt, unit, context);
    const registrationMatch = invokeExpr
        ? resolveApprovedImperativeRegistrationMatch(scene, caller, invokeExpr, explicitArgs)
        : undefined;
    const callbackArgIndexes = registrationMatch?.callbackArgIndexes || [];
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
        bindingKind: "imperative",
        localRegistration,
        registrationReachabilityDepth,
        usesPtrInvoke: String(stmt.toString?.() || "").includes("ptrinvoke "),
        hasAwaitResume: methodStmtTexts(caller).some(text => text.includes("await ")),
        payloadPorts: countPayloadPorts(unit),
        capturePorts: countCapturePorts(unit),
    };
}

function collectDeclarativeExecutionHandoffFeatures(
    binding: DeclarativeDeferredBindingRecord,
): ExecutionHandoffFeatures {
    const bindingText = `${binding.decoratorKind}(${binding.targetField})`;
    return {
        invokeText: bindingText,
        invokeName: binding.decoratorKind,
        matchingArgIndexes: [],
        callableArgIndexes: [],
        bindingKind: "declarative",
        localRegistration: false,
        registrationReachabilityDepth: null,
        usesPtrInvoke: false,
        hasAwaitResume: false,
        payloadPorts: countPayloadPorts(binding.unit),
        capturePorts: countCapturePorts(binding.unit),
        declarativeTriggerLabel: binding.targetField,
    };
}

function collectExplicitExecutionHandoffFeatures(
    binding: ModuleExplicitDeferredBindingRecord,
): ExecutionHandoffFeatures {
    const bindingText = binding.bindingKind === "imperative"
        ? (binding.invokeText || binding.anchorStmt?.toString?.() || binding.reason)
        : binding.triggerLabel;
    const completion = binding.semantics.completion || "none";
    return {
        invokeText: bindingText,
        invokeName: binding.bindingKind === "imperative"
            ? binding.anchorStmt?.getInvokeExpr?.()?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || null
            : bindingText,
        matchingArgIndexes: [],
        callableArgIndexes: [],
        bindingKind: binding.bindingKind,
        localRegistration: binding.bindingKind === "imperative" && binding.semantics.activation === "event(c)",
        registrationReachabilityDepth: binding.bindingKind === "imperative" && binding.semantics.activation === "event(c)"
            ? 0
            : null,
        usesPtrInvoke: false,
        hasAwaitResume: completion === "await_site",
        payloadPorts: countPayloadPorts(binding.unit),
        capturePorts: countCapturePorts(binding.unit),
        declarativeTriggerLabel: binding.bindingKind === "declarative" ? binding.triggerLabel : undefined,
    };
}

function collectFutureUnitCandidates(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    context: ExecutionHandoffProvenanceContext,
    budget?: ExecutionHandoffBuildBudget,
): ExecutionHandoffCandidate[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const out = new Map<string, ExecutionHandoffCandidate>();
    const addMethod = (method: any, sourceMethod: any, carrierKind: HandoffCarrierKind): void => {
        const signature = methodSignature(method);
        if (!signature || !method?.getCfg?.() || !isValidDeferredUnitSignature(signature)) return;
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
    let hasPotentialDeferredCarrier = false;
    const addMethodsFromValue = (value: any, phase: string): void => {
        if (!value) return;
        if (!isPotentialDeferredUnitCarrierValue(value)) return;
        hasPotentialDeferredCarrier = true;
        assertExecutionHandoffBudget(budget, `${phase}.returns`);
        for (const method of resolveCallbackMethodsFromValueWithReturnsCached(scene, value, context)) {
            addMethod(method, caller, "returned");
        }
        assertExecutionHandoffBudget(budget, `${phase}.anonymous_carrier`);
        for (const { baseValue, fieldName } of collectAnonymousCarrierFieldLookups(value)) {
            if (!fieldName || !baseValue) continue;
            for (const method of resolveMethodsFromAnonymousCarrierByFieldCached(scene, baseValue, fieldName, context)) {
                addMethod(method, caller, "field");
            }
        }
        assertExecutionHandoffBudget(budget, `${phase}.callable`);
        for (const method of resolveMethodsFromCallableCached(scene, value, context)) {
            addMethod(method, caller, "direct");
        }
    };

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of explicitArgs) {
        addMethodsFromValue(arg, "activation_paths.candidates.explicit_args");
    }

    const base = invokeExpr.getBase?.();
    if (base && (isCallableValue(base) || String(stmt.toString?.() || "").includes("ptrinvoke "))) {
        addMethodsFromValue(base, "activation_paths.candidates.base");
    }

    const methodName = invokeMethodName(stmt) || "";
    const isKnownRegistrationInvoke = isKnownFrameworkCallbackMethodName(methodName)
        || isKnownSchedulerMethodName(methodName);
    const isPtrInvoke = String(stmt.toString?.() || "").includes("ptrinvoke ");
    if (!hasPotentialDeferredCarrier && !isKnownRegistrationInvoke && !isPtrInvoke) {
        return [...out.values()];
    }
    const hasDirectDeferredCallbackArg = explicitArgs.some(isDirectDeferredCallbackArgument);
    const shouldRunRegistrationExpansion = isKnownRegistrationInvoke
        || isPtrInvoke
        || hasDirectDeferredCallbackArg;
    if (!shouldRunRegistrationExpansion) {
        assertExecutionHandoffBudget(
            budget,
            `activation_paths.candidates.registration_skip(site=${formatCandidateSite(caller, stmt)})`,
        );
        return [...out.values()];
    }

    assertExecutionHandoffBudget(budget, "activation_paths.candidates.registration_query");
    const registrations = resolveCallbackRegistrationsFromStmt(
        stmt,
        scene,
        caller,
        args => resolveApprovedImperativeRegistrationMatch(args.scene, args.sourceMethod, args.invokeExpr, args.explicitArgs),
        { maxDepth: 4 },
    );
    for (const registration of registrations) {
        assertExecutionHandoffBudget(
            budget,
            `activation_paths.candidates.registration_results(count=${registrations.length},site=${formatCandidateSite(caller, stmt)})`,
        );
        addMethod(
            registration.callbackMethod,
            registration.sourceMethod || caller,
            methodSignature(registration.registrationMethod) !== methodSignature(caller) ? "relay" : "direct",
        );
    }
    assertExecutionHandoffBudget(
        budget,
        `activation_paths.candidates.registration_done(count=${registrations.length},site=${formatCandidateSite(caller, stmt)})`,
    );

    assertExecutionHandoffBudget(
        budget,
        `activation_paths.candidates.resolved_callback_bindings.start(site=${formatCandidateSite(caller, stmt)})`,
    );
    const resolvedBindings = collectResolvedCallbackBindingsForStmt(
        scene,
        cg,
        caller,
        stmt,
        invokeExpr,
        new Map<string, Set<number>>(),
    );
    for (const binding of resolvedBindings) {
        assertExecutionHandoffBudget(budget, "activation_paths.candidates.resolved_callback_results");
        addMethod(
            binding.method,
            binding.sourceMethod || caller,
            binding.reason === "one_hop" ? "relay" : "direct",
        );
    }

    assertExecutionHandoffBudget(budget, "activation_paths.candidates.approved_registration");
    const registrationMatch = resolveApprovedImperativeRegistrationMatch(scene, caller, invokeExpr, explicitArgs);
    const callbackArgIndexes = registrationMatch?.callbackArgIndexes || [];
    for (const callbackArgIndex of callbackArgIndexes) {
        assertExecutionHandoffBudget(budget, "activation_paths.candidates.relay_origins");
        const callbackValue = explicitArgs[callbackArgIndex];
        for (const origin of resolveRelayCallbackOrigins(scene, caller, callbackValue, context)) {
            assertExecutionHandoffBudget(budget, "activation_paths.candidates.relay_origin_results");
            addMethod(origin.method, origin.sourceMethod, origin.carrierKind);
        }
    }

    return [...out.values()];
}

function isPotentialDeferredUnitCarrierValue(value: any): boolean {
    if (!value) return false;
    if (isCallableValue(value)) return true;
    if (value instanceof ArkInstanceFieldRef || value instanceof ClosureFieldRef) return true;

    const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase();
    if (/(function|callback|lambda|closure|=>)/.test(typeText)) return true;

    const text = String(value.toString?.() || "").toLowerCase();
    if (/(callback|cb|handler|listener|success|fail|complete|resolve|reject|continuation)/.test(text)) {
        return true;
    }

    if (value instanceof Local) {
        const declaringStmt = value.getDeclaringStmt?.();
        const right = (declaringStmt as any)?.getRightOp?.();
        if (right instanceof ArkInstanceFieldRef || right instanceof ClosureFieldRef) return true;
        if (right && isCallableValue(right)) return true;
        const rightText = String(right?.toString?.() || "").toLowerCase();
        if (/(callback|cb|handler|listener|success|fail|complete|resolve|reject|continuation|=>)/.test(rightText)) {
            return true;
        }
    }

    return false;
}

function isDirectDeferredCallbackArgument(value: any): boolean {
    if (!value) return false;
    if (isCallableValue(value)) return true;

    const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase();
    if (/(function|callback|lambda|closure|=>)/.test(typeText)) return true;

    const text = String(value.toString?.() || "").toLowerCase();
    if (/(callback|cb|handler|listener|success|fail|complete|resolve|reject|continuation)/.test(text)) {
        return true;
    }

    if (value instanceof Local) {
        const declaringStmt = value.getDeclaringStmt?.();
        const right = (declaringStmt as any)?.getRightOp?.();
        if (right && isCallableValue(right)) return true;
        const rightType = String(right?.getType?.()?.toString?.() || "").toLowerCase();
        if (/(function|callback|lambda|closure|=>)/.test(rightType)) return true;
        const rightText = String(right?.toString?.() || "").toLowerCase();
        if (/(callback|cb|handler|listener|success|fail|complete|resolve|reject|continuation|=>)/.test(rightText)) {
            return true;
        }
    }

    return false;
}

function formatCandidateSite(caller: any, stmt: any): string {
    const sig = methodSignature(caller);
    const line = stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0;
    const shortSig = sig.length > 120 ? `${sig.slice(0, 117)}...` : sig;
    return `${shortSig}#${line}`;
}

function resolveCallbackMethodsFromValueWithReturnsCached(
    scene: Scene,
    value: any,
    context: ExecutionHandoffProvenanceContext,
): any[] {
    if (!context.callbackMethodsWithReturnsByValue.has(value)) {
        context.callbackMethodsWithReturnsByValue.set(
            value,
            resolveCallbackMethodsFromValueWithReturns(scene, value, { maxDepth: 6 }),
        );
    }
    return context.callbackMethodsWithReturnsByValue.get(value) || [];
}

function resolveMethodsFromCallableCached(
    scene: Scene,
    value: any,
    context: ExecutionHandoffProvenanceContext,
): any[] {
    if (!context.callableMethodsByValue.has(value)) {
        context.callableMethodsByValue.set(
            value,
            resolveMethodsFromCallable(scene, value, CALLBACK_RESOLVE_OPTIONS),
        );
    }
    return context.callableMethodsByValue.get(value) || [];
}

function resolveMethodsFromAnonymousCarrierByFieldCached(
    scene: Scene,
    baseValue: any,
    fieldName: string,
    context: ExecutionHandoffProvenanceContext,
): any[] {
    let byField = context.anonymousCarrierMethodsByBaseAndField.get(baseValue);
    if (!byField) {
        byField = new Map<string, any[]>();
        context.anonymousCarrierMethodsByBaseAndField.set(baseValue, byField);
    }
    if (!byField.has(fieldName)) {
        byField.set(
            fieldName,
            resolveMethodsFromAnonymousObjectCarrierByField(scene, baseValue, fieldName, CALLBACK_RESOLVE_OPTIONS),
        );
    }
    return byField.get(fieldName) || [];
}

function resolveRelayCallbackOrigins(
    scene: Scene,
    carrierMethod: any,
    value: any,
    context: ExecutionHandoffProvenanceContext,
    visited: Set<string> = new Set<string>(),
): RelayOrigin[] {
    const direct = resolveCallbackMethodsFromValueWithReturnsCached(scene, value, context);
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
        for (const method of resolveCallbackMethodsFromValueWithReturnsCached(scene, actualArg, context)) {
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

function collectArgMatchIndexes(
    scene: Scene,
    stmt: any,
    unit: any,
    context: ExecutionHandoffProvenanceContext,
): { callableArgIndexes: number[]; matchingArgIndexes: number[] } {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) {
        return { callableArgIndexes: [], matchingArgIndexes: [] };
    }
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const unitSignature = methodSignature(unit);
    const callableArgIndexes: number[] = [];
    const matchingArgIndexes: number[] = [];
    explicitArgs.forEach((arg: any, index: number) => {
        const methods = resolveMethodsFromCallableCached(scene, arg, context);
        if (methods.length > 0 || isCallableValue(arg)) {
            callableArgIndexes.push(index);
        }
        if (methods.some(method => methodSignature(method) === unitSignature)) {
            matchingArgIndexes.push(index);
        }
    });
    return { callableArgIndexes, matchingArgIndexes };
}

function resolveApprovedImperativeRegistrationMatch(
    scene: Scene,
    sourceMethod: any,
    invokeExpr: any,
    explicitArgs: any[],
): { callbackArgIndexes: number[]; reason?: string } | null {
    const isDeferredCompletion = !!recoverDeferredCompletionSemantics({
        invokeName: invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || null,
        matchingArgIndexes: [],
        payloadPorts: 0,
        hasResumeAnchor: false,
    });
    if (isDeferredCompletion) {
        return null;
    }

    const matcherArgs = {
        scene,
        sourceMethod,
        invokeExpr,
        explicitArgs,
    };

    return resolveKnownSchedulerCallbackRegistration(matcherArgs)
        || resolveKnownChannelCallbackRegistration(matcherArgs)
        || resolveKnownFrameworkCallbackRegistration(matcherArgs);
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
        const directMethods = resolveCallbackMethodsFromValueWithReturnsCached(scene, actualArg, context);
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

function buildIncomingCallsiteIndex(
    scene: Scene,
    cg: CallGraph,
    budget?: ExecutionHandoffBuildBudget,
): Map<string, IncomingCallSite[]> {
    const out = new Map<string, IncomingCallSite[]>();
    const dedup = new Map<string, Set<string>>();

    for (const method of scene.getMethods()) {
        assertExecutionHandoffBudget(budget, "incoming_callsite_index.methods");
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            assertExecutionHandoffBudget(budget, "incoming_callsite_index.statements");
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

function isValidDeferredUnitSignature(signature: string): boolean {
    if (!signature) return false;
    return !signature.includes(".constructor(") && !signature.includes(".%instInit(");
}

function methodStmtTexts(method: any): string[] {
    const cfg = method?.getCfg?.();
    if (!cfg) return [];
    return cfg.getStmts().map((stmt: any) => stmt.toString());
}

function collectAnonymousCarrierFieldLookups(
    value: any,
): Array<{ baseValue: any; fieldName: string }> {
    const out: Array<{ baseValue: any; fieldName: string }> = [];
    const seen = new Set<string>();
    const addFieldLookup = (baseValue: any, fieldName: string | undefined): void => {
        if (!baseValue || !fieldName) return;
        const key = `${String(baseValue)}::${fieldName}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ baseValue, fieldName });
    };

    if (value instanceof ArkInstanceFieldRef || value instanceof ClosureFieldRef) {
        const fieldName = value instanceof ClosureFieldRef
            ? value.getFieldName?.()
            : value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
        addFieldLookup(value.getBase?.(), fieldName);
        return out;
    }

    if (value instanceof Local) {
        const declStmt = value.getDeclaringStmt?.();
        if (declStmt instanceof ArkAssignStmt && declStmt.getLeftOp?.() === value) {
            const right = declStmt.getRightOp?.();
            if (right instanceof ArkInstanceFieldRef || right instanceof ClosureFieldRef) {
                const fieldName = right instanceof ClosureFieldRef
                    ? right.getFieldName?.()
                    : right.getFieldSignature?.().getFieldName?.() || right.getFieldName?.();
                addFieldLookup(right.getBase?.(), fieldName);
            }
        }
    }

    return out;
}

function deriveRecoveredSemantics(features: ExecutionHandoffFeatures): RecoveredExecutionHandoffSemantics {
    if (features.bindingKind === "declarative") {
        return buildRecoveredSemantics("declare", "event(c)", "none", [], "none");
    }
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

function recoverSemanticsFromExplicitBinding(
    binding: ModuleExplicitDeferredBindingRecord,
): RecoveredExecutionHandoffSemantics {
    const activation = binding.semantics.activation;
    const completion = binding.semantics.completion || "none";
    const preserve = [...(binding.semantics.preserve || [])];
    const continuationRole = binding.semantics.continuationRole || "none";
    if (activation === "settle(fulfilled)") {
        return buildRecoveredSemantics("settle_f", activation, completion, preserve, continuationRole);
    }
    if (activation === "settle(rejected)") {
        return buildRecoveredSemantics("settle_r", activation, completion, preserve, continuationRole);
    }
    if (activation === "settle(any)") {
        return buildRecoveredSemantics("settle_a", activation, completion, preserve, continuationRole);
    }
    return buildRecoveredSemantics(
        binding.bindingKind === "declarative" ? "declare" : "register",
        activation,
        completion,
        preserve,
        continuationRole,
    );
}

function buildRecoveredSemantics(
    activationLabel: HandoffActivationLabel,
    activation: HandoffTriggerToken,
    completion: HandoffResumeKind,
    preserve: ExecutionHandoffActivationToken[],
    continuationRole: ExecutionHandoffContinuationRole,
): RecoveredExecutionHandoffSemantics {
    return {
        activationLabel,
        semantics: {
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
        case "declare":
            labels.push("declare");
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
