import type { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import type { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkMainEntryFact } from "../ArkMainTypes";
import {
    isSdkBackedMethodSignature,
    isSdkImportFrom,
} from "../../../substrate/queries/SdkProvenance";
import {
    ARK_MAIN_NAVIGATION_SOURCE_OWNER_CLASS_NAMES,
    ARK_MAIN_ROUTER_OWNER_CLASS_NAMES,
    ARK_MAIN_ROUTER_SOURCE_METHOD_NAMES,
    ARK_MAIN_ROUTER_TRIGGER_METHOD_NAMES,
} from "../catalog/ArkMainFrameworkCatalog";

type ArkMainChannelFactKind = Extract<ArkMainEntryFact["kind"], "router_source" | "router_trigger">;
type ArkMainChannelRecognitionLayer =
    | "sdk_provenance_first_layer"
    | "sdk_import_provenance_first_layer"
    | "owner_qualified_fallback";

export interface ArkMainChannelInvocationCandidate {
    sourceMethod: ArkMethod;
    methodName: string;
    className: string;
    discoveryShape: "direct_channel_call";
    recognitionLayer: ArkMainChannelRecognitionLayer;
}

export interface ArkMainChannelInvocationMatch {
    factKind: ArkMainChannelFactKind;
    entryFamily: "navigation_source" | "navigation_trigger";
    entryShape: "direct_source_call" | "direct_trigger_call";
    recognitionLayer: ArkMainChannelRecognitionLayer;
    reason: string;
}

export function resolveArkMainChannelInvocation(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
): ArkMainChannelInvocationMatch | null {
    const candidate = resolveArkMainChannelInvocationCandidate(scene, sourceMethod, invokeExpr);
    if (!candidate) {
        return null;
    }
    return classifyArkMainChannelInvocationCandidate(candidate);
}

export function resolveArkMainChannelInvocationCandidate(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
): ArkMainChannelInvocationCandidate | null {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (!methodName) {
        return null;
    }

    if (isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr })) {
        return {
            sourceMethod,
            methodName,
            className,
            discoveryShape: "direct_channel_call",
            recognitionLayer: "sdk_provenance_first_layer",
        };
    }

    const importProvenanceClassName = resolveSdkImportProvenanceChannelOwner(sourceMethod, invokeExpr, methodName);
    if (importProvenanceClassName) {
        return {
            sourceMethod,
            methodName,
            className: importProvenanceClassName,
            discoveryShape: "direct_channel_call",
            recognitionLayer: "sdk_import_provenance_first_layer",
        };
    }

    if (!isKnownFallbackChannelOwner(className, methodName)) {
        return null;
    }

    return {
        sourceMethod,
        methodName,
        className,
        discoveryShape: "direct_channel_call",
        recognitionLayer: "owner_qualified_fallback",
    };
}

export function classifyArkMainChannelInvocationCandidate(
    candidate: ArkMainChannelInvocationCandidate,
): ArkMainChannelInvocationMatch | null {
    const { sourceMethod, methodName, className, recognitionLayer } = candidate;
    if (
        ARK_MAIN_ROUTER_SOURCE_METHOD_NAMES.has(methodName)
        && ARK_MAIN_NAVIGATION_SOURCE_OWNER_CLASS_NAMES.has(className)
    ) {
        return {
            factKind: "router_source",
            entryFamily: "navigation_source",
            entryShape: "direct_source_call",
            recognitionLayer,
            reason: `Method ${sourceMethod.getName()} issues navigation source ${className}.${methodName}`,
        };
    }

    if (
        ARK_MAIN_ROUTER_TRIGGER_METHOD_NAMES.has(methodName)
        && ARK_MAIN_ROUTER_OWNER_CLASS_NAMES.has(className)
    ) {
        return {
            factKind: "router_trigger",
            entryFamily: "navigation_trigger",
            entryShape: "direct_trigger_call",
            recognitionLayer,
            reason: `Method ${sourceMethod.getName()} touches navigation trigger ${className}.${methodName}`,
        };
    }

    return null;
}

function isKnownFallbackChannelOwner(className: string, methodName: string): boolean {
    return (
        (ARK_MAIN_NAVIGATION_SOURCE_OWNER_CLASS_NAMES.has(className) && ARK_MAIN_ROUTER_SOURCE_METHOD_NAMES.has(methodName))
        || (ARK_MAIN_ROUTER_OWNER_CLASS_NAMES.has(className) && ARK_MAIN_ROUTER_TRIGGER_METHOD_NAMES.has(methodName))
    );
}

function resolveSdkImportProvenanceChannelOwner(
    sourceMethod: ArkMethod,
    invokeExpr: any,
    methodName: string,
): string | undefined {
    const baseName = invokeExpr?.getBase?.()?.getName?.() || invokeExpr?.getBase?.()?.toString?.() || "";
    if (!baseName) {
        return undefined;
    }
    const importInfo = sourceMethod.getDeclaringArkFile?.()?.getImportInfoBy?.(baseName);
    const importFrom = importInfo?.getFrom?.() || "";
    if (!isSdkImportFrom(importFrom)) {
        return undefined;
    }

    if (
        (ARK_MAIN_ROUTER_SOURCE_METHOD_NAMES.has(methodName) || ARK_MAIN_ROUTER_TRIGGER_METHOD_NAMES.has(methodName))
        && isRouterLikeImport(baseName, importFrom)
    ) {
        return "Router";
    }

    return undefined;
}
function isRouterLikeImport(baseName: string, importFrom: string): boolean {
    return (
        /@ohos\.router$/.test(importFrom)
        || /@system\.router$/.test(importFrom)
        || (/^@kit\.ArkUI$/.test(importFrom) && (baseName === "Router" || baseName === "router"))
    );
}

