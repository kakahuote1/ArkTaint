import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { ArkInstanceFieldRef, ClosureFieldRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { collectParameterAssignStmts } from "../../substrate/queries/CalleeResolver";
import {
    ExecutionHandoffActivationPathRecord,
    ExecutionUnitSummaryRecord,
} from "./ExecutionHandoffContract";

export function buildExecutionUnitSummary(
    path: ExecutionHandoffActivationPathRecord,
): ExecutionUnitSummaryRecord {
    const bindings = collectMethodParameterBindings(path.unit);
    const payloadLocals = new Set<string>(bindings.filter(binding => !binding.local.startsWith("%closures")).map(binding => binding.local));
    const explicitCaptureLocals = new Set<string>(bindings.filter(binding => binding.local.startsWith("%closures")).map(binding => binding.local));
    const context = collectMethodBodyContext(path.unit);
    const implicitCaptureLocals = collectImplicitCaptureLocals(path.unit, payloadLocals, explicitCaptureLocals);
    const envReadPorts = collectEnvReadPorts(
        path.unit,
        payloadLocals,
        explicitCaptureLocals,
        implicitCaptureLocals,
        context,
    );
    const envWriteLocals = collectImplicitEnvWriteLocals(
        path.unit,
        payloadLocals,
        explicitCaptureLocals,
        context,
    );
    const captureLocals = new Set<string>([
        ...explicitCaptureLocals,
        ...implicitCaptureLocals,
    ]);

    return {
        payloadPorts: bindings.filter(binding => !binding.local.startsWith("%closures")).length,
        capturePorts: captureLocals.size,
        envReadPorts: envReadPorts.size,
        envWritePorts: envWriteLocals.size,
        returnKind: inferReturnKind(path.unit, payloadLocals, captureLocals),
        preserve: [...path.semantics.preserve],
    };
}

function inferReturnKind(
    method: any,
    payloadLocals: Set<string>,
    captureLocals: Set<string>,
): ExecutionUnitSummaryRecord["returnKind"] {
    const returnStmts = method.getReturnStmt?.() || [];
    if (returnStmts.length === 0) {
        return "none";
    }

    for (const retStmt of returnStmts) {
        if (!(retStmt instanceof ArkReturnStmt)) continue;
        const retValue = retStmt.getOp?.();
        const localName = retValue instanceof Local ? retValue.getName?.() : undefined;
        if (!localName) continue;
        if (payloadLocals.has(localName)) return "payload";
        if (captureLocals.has(localName)) return "capture";
        return "value";
    }

    return "none";
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

function collectImplicitCaptureLocals(
    method: any,
    payloadLocals: Set<string>,
    explicitCaptureLocals: Set<string>,
): Set<string> {
    const out = new Set<string>();
    const context = collectMethodBodyContext(method);
    if (!context.cfg) {
        return out;
    }

    for (const stmt of context.cfg.getStmts()) {
        const uses = typeof stmt?.getUses === "function" ? stmt.getUses() : [];
        for (const value of uses) {
            if (!(value instanceof Local)) {
                continue;
            }
            const localName = value.getName?.() || "";
            if (!localName || localName === "this") {
                continue;
            }
            if (payloadLocals.has(localName) || explicitCaptureLocals.has(localName)) {
                continue;
            }
            if (context.bodyLocalNames.has(localName)) {
                continue;
            }
            if (declaresInCurrentMethod(value, context.methodSignature)) {
                continue;
            }
            out.add(localName);
        }
    }

    return out;
}

function collectEnvReadPorts(
    method: any,
    payloadLocals: Set<string>,
    explicitCaptureLocals: Set<string>,
    implicitCaptureLocals: Set<string>,
    context: MethodBodyContext,
): Set<string> {
    const out = new Set<string>([
        ...explicitCaptureLocals,
        ...implicitCaptureLocals,
    ]);
    if (!context.cfg) {
        return out;
    }

    for (const stmt of context.cfg.getStmts()) {
        const uses = typeof stmt?.getUses === "function" ? stmt.getUses() : [];
        for (const value of uses) {
            if (value instanceof ClosureFieldRef) {
                const fieldName = value.getFieldName?.() || "";
                if (fieldName) {
                    out.add(`closure:${fieldName}`);
                }
                continue;
            }
            if (!(value instanceof ArkInstanceFieldRef)) {
                continue;
            }
            const base = value.getBase?.();
            if (!(base instanceof Local)) {
                continue;
            }
            if (!isEnvBaseLocal(base, payloadLocals, explicitCaptureLocals, context)) {
                continue;
            }
            const fieldName = value.getFieldSignature?.().getFieldName?.() || "";
            if (fieldName) {
                out.add(`field:${base.getName?.()}:${fieldName}`);
            }
        }
    }

    return out;
}

function collectImplicitEnvWriteLocals(
    method: any,
    payloadLocals: Set<string>,
    explicitCaptureLocals: Set<string>,
    context: MethodBodyContext,
): Set<string> {
    const out = new Set<string>();
    if (!context.cfg) {
        return out;
    }

    for (const stmt of context.cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) {
            continue;
        }
        const left = stmt.getLeftOp?.();
        if (!left) {
            continue;
        }

        if (left instanceof Local) {
            const localName = left.getName?.() || "";
            if (!localName || localName === "this" || localName.startsWith("%")) {
                continue;
            }
            if (payloadLocals.has(localName) || explicitCaptureLocals.has(localName)) {
                continue;
            }
            if (context.bodyLocalNames.has(localName)) {
                continue;
            }
            if (declaresInCurrentMethod(left, context.methodSignature)) {
                continue;
            }
            out.add(localName);
            continue;
        }

        if (left instanceof ClosureFieldRef) {
            const fieldName = left.getFieldName?.() || "";
            if (fieldName) {
                out.add(fieldName);
            }
            continue;
        }

        if (left instanceof ArkInstanceFieldRef) {
            const base = left.getBase?.();
            if (!(base instanceof Local)) {
                continue;
            }
            if (!isEnvBaseLocal(base, payloadLocals, explicitCaptureLocals, context)) {
                continue;
            }
            const fieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (fieldName) {
                out.add(`field:${base.getName?.()}:${fieldName}`);
            }
        }
    }

    return out;
}

interface MethodBodyContext {
    cfg: any;
    methodSignature: string;
    bodyLocalNames: Set<string>;
}

function collectMethodBodyContext(method: any): MethodBodyContext {
    const cfg = method?.getCfg?.();
    const methodSignature = method?.getSignature?.()?.toString?.() || "";
    const bodyLocalNames = new Set<string>();
    const bodyLocals = method?.getBody?.()?.getLocals?.();
    if (bodyLocals?.values) {
        for (const local of bodyLocals.values()) {
            const localName = local?.getName?.();
            if (localName) {
                bodyLocalNames.add(localName);
            }
        }
    }
    return {
        cfg,
        methodSignature,
        bodyLocalNames,
    };
}

function declaresInCurrentMethod(value: Local, methodSignature: string): boolean {
    const declaringMethodSignature = value
        .getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
    return !!declaringMethodSignature && declaringMethodSignature === methodSignature;
}

function isEnvBaseLocal(
    value: Local,
    payloadLocals: Set<string>,
    explicitCaptureLocals: Set<string>,
    context: MethodBodyContext,
): boolean {
    const localName = value.getName?.() || "";
    if (!localName || payloadLocals.has(localName)) {
        return false;
    }
    if (localName === "this") {
        return true;
    }
    if (explicitCaptureLocals.has(localName) || localName.startsWith("%closures")) {
        return true;
    }
    if (localName.startsWith("%") || context.bodyLocalNames.has(localName)) {
        return false;
    }
    return !declaresInCurrentMethod(value, context.methodSignature);
}
