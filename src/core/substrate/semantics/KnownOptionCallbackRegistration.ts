import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import {
    resolveCalleeCandidates,
    resolveMethodsFromAnonymousObjectCarrierByField,
} from "../queries/CalleeResolver";
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
    reason: string;
    callbackFlavor: "channel";
    registrationShape: "options_object_slot";
    slotFamily: "controller_option_slot";
    recognitionLayer: "controller_options";
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
            || spec.ownerClassNames.has(className);
    }
    return matchesModuleSemanticOptionObjectCallbackSpec(spec, scene, sourceMethod, invokeExpr);
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
