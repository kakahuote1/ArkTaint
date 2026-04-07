import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { collectQualifiedDeclarativeFieldTriggerSpecsForMethod } from "../model/DeclarativeFieldTriggerSemantics";

export interface DeclarativeDeferredBindingRecord {
    sourceMethod: any;
    unit: any;
    anchorStmt: any;
    decoratorKind: string;
    targetField: string;
    familyId: "declarative_field_trigger";
}

export function collectDeclarativeDeferredBindings(
    scene: Scene,
): DeclarativeDeferredBindingRecord[] {
    const out: DeclarativeDeferredBindingRecord[] = [];
    const seen = new Set<string>();

    for (const cls of scene.getClasses()) {
        const methods = cls.getMethods?.() || [];
        const handlers = methods.flatMap((method: any) => {
            const specs = collectQualifiedDeclarativeFieldTriggerSpecsForMethod(method);
            return specs
                .map(spec => ({ method, spec }));
        });
        if (handlers.length === 0) continue;

        for (const { method: handlerMethod, spec } of handlers) {
            for (const sourceMethod of methods) {
                if (sourceMethod === handlerMethod) continue;
                for (const anchorStmt of collectThisFieldWriteAnchors(
                    sourceMethod,
                    spec.targetField,
                )) {
                    const key = [
                        sourceMethod.getSignature?.()?.toString?.() || "",
                        handlerMethod.getSignature?.()?.toString?.() || "",
                        anchorStmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0,
                        spec.decoratorKind,
                        spec.targetField,
                    ].join("|");
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push({
                        sourceMethod,
                        unit: handlerMethod,
                        anchorStmt,
                        decoratorKind: spec.decoratorKind,
                        targetField: spec.targetField,
                        familyId: "declarative_field_trigger",
                    });
                }
            }
        }
    }

    return out;
}

function collectThisFieldWriteAnchors(
    method: any,
    targetField: string,
): any[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];

    const out: any[] = [];
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const base = left.getBase?.();
        if (!(base instanceof Local) || base.getName?.() !== "this") continue;
        const fieldName = left.getFieldSignature?.().getFieldName?.()
            || left.getFieldName?.()
            || "";
        if (fieldName !== targetField) continue;
        out.push(stmt);
    }
    return out;
}
