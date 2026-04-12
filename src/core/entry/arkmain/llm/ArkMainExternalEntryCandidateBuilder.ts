import type { ModifierType } from "../../../../../arkanalyzer/out/src/core/model/ArkBaseModel";
import type { ArkMainEntryFact } from "../ArkMainTypes";
import {
    collectFrameworkManagedOwners,
} from "../facts/ArkMainOwnerDiscovery";
import {
    collectSdkOverrideCandidates,
} from "../facts/ArkMainStructuralDiscovery";
import { ArkMainExternalEntryCandidate } from "./ArkMainExternalEntryTypes";

export interface BuildArkMainExternalEntryCandidateOptions {
    maxCandidates?: number;
}

type ArkMainMethod = ArkMainEntryFact["method"];
type ArkMainClassLike = {
    getName?: () => string;
    getMethods(): ArkMainMethod[];
    getSuperClassName?: () => string;
    getSuperClass?: () => { getName?: () => string } | null | undefined;
    getDeclaringArkFile?: () => { getFilePath?: () => string; getName?: () => string } | null | undefined;
};

type ArkMainSceneLike = {
    getClasses(): ArkMainClassLike[];
};

const FRAMEWORK_HINT_WORDS = [
    "ability",
    "stage",
    "extension",
    "component",
    "page",
    "router",
    "route",
    "nav",
    "navigation",
    "context",
    "window",
    "ui",
    "service",
    "plugin",
    "want",
    "app",
];

export function buildArkMainExternalEntryCandidates(
    scene: ArkMainSceneLike,
    options: BuildArkMainExternalEntryCandidateOptions = {},
): ArkMainExternalEntryCandidate[] {
    const maxCandidates = options.maxCandidates ?? 200;
    const out: ArkMainExternalEntryCandidate[] = [];
    const seen = new Set<string>();
    const managedOwners = collectFrameworkManagedOwners(scene as never, {
        includeComponentContractShape: true,
    });
    const sdkOverrideBySignature = new Map(
        collectSdkOverrideCandidates(scene as never).map(candidate => [
            candidate.method.getSignature?.()?.toString?.() || "",
            candidate,
        ]),
    );

    for (const cls of scene.getClasses()) {
        for (const method of cls.getMethods()) {
            if (!isEligibleMethod(method)) {
                continue;
            }

            const methodSignature = method.getSignature?.()?.toString?.();
            if (!methodSignature || seen.has(methodSignature)) {
                continue;
            }

            const methodName = String(method.getName?.() || "");
            if (!methodName) {
                continue;
            }

            const candidate = buildCandidate(
                cls,
                method,
                methodSignature,
                methodName,
                managedOwners,
                sdkOverrideBySignature.get(methodSignature),
            );
            if (!candidate) {
                continue;
            }

            seen.add(methodSignature);
            out.push(candidate);
            if (out.length >= maxCandidates) {
                return sortCandidates(out);
            }
        }
    }

    return sortCandidates(out);
}

function buildCandidate(
    cls: ArkMainClassLike,
    method: ArkMainMethod,
    methodSignature: string,
    methodName: string,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
    sdkOverrideCandidate?: ReturnType<typeof collectSdkOverrideCandidates>[number],
): ArkMainExternalEntryCandidate | null {
    const className = String(cls.getName?.() || "");
    const superClassName = String(cls.getSuperClass?.()?.getName?.() || cls.getSuperClassName?.() || "");
    const filePath = safeGetDeclaringFilePath(cls);
    const parameterTypes = (method.getParameters?.() || [])
        .map((param: any) => String(param?.getType?.()?.toString?.() || ""))
        .filter(Boolean);
    const returnType = String(method.getReturnType?.()?.toString?.() || "") || undefined;
    const isOverride = Boolean(method.containsModifier?.(8192 as ModifierType) || method.containsModifier?.(8 as ModifierType));
    const ownerEvidenceSignals = managedOwners
        .getEvidences(cls as never)
        .map(evidence => `${evidence.ownerKind}:${evidence.recognitionLayer}`);
    const ownerSignals = [
        ...ownerEvidenceSignals.map(signal => `owner_contract:${signal}`),
        ...collectHintSignals([className, superClassName, filePath || ""]).map(signal => `owner_hint:${signal}`),
    ];
    const overrideSignals = [
        ...(isOverride ? ["override:explicit"] : []),
        ...(sdkOverrideCandidate?.baseClass?.getName?.()
            ? [`override:sdk_base_class:${sdkOverrideCandidate.baseClass.getName()}`]
            : []),
        ...(sdkOverrideCandidate?.baseMethod?.getName?.()
            ? [`override:sdk_base_method:${sdkOverrideCandidate.baseMethod.getName()}`]
            : []),
    ];
    const frameworkSignals = collectHintSignals([methodName, ...parameterTypes, returnType || "", methodSignature])
        .map(signal => `framework_hint:${signal}`);

    if (
        ownerSignals.length === 0
        && overrideSignals.length === 0
        && frameworkSignals.length < 2
    ) {
        return null;
    }

    return {
        method,
        methodSignature,
        className,
        methodName,
        filePath,
        superClassName: superClassName || undefined,
        parameterTypes,
        returnType,
        isOverride,
        ownerSignals,
        overrideSignals,
        frameworkSignals,
        summaryText: [
            `signature: ${methodSignature}`,
            `class: ${className || "-"}`,
            `method: ${methodName}`,
            `superClass: ${superClassName || "-"}`,
            `filePath: ${filePath || "-"}`,
            `isOverride: ${isOverride}`,
            `parameterTypes: ${parameterTypes.join(", ") || "-"}`,
            `returnType: ${returnType || "-"}`,
            `managedOwnerEvidences: ${ownerEvidenceSignals.join(", ") || "-"}`,
            `sdkOverrideBaseClass: ${sdkOverrideCandidate?.baseClass?.getName?.() || "-"}`,
            `sdkOverrideBaseMethod: ${sdkOverrideCandidate?.baseMethod?.getName?.() || "-"}`,
            `ownerSignals: ${ownerSignals.join(", ") || "-"}`,
            `overrideSignals: ${overrideSignals.join(", ") || "-"}`,
            `frameworkSignals: ${frameworkSignals.join(", ") || "-"}`,
        ].join("\n"),
    };
}

function isEligibleMethod(method: ArkMainMethod): boolean {
    if (method.isStatic?.() || method.isPrivate?.()) {
        return false;
    }
    if (method.isGenerated?.() || method.isAnonymousMethod?.()) {
        return false;
    }
    return true;
}

function collectHintSignals(texts: string[]): string[] {
    const hits = new Set<string>();
    for (const raw of texts) {
        const text = String(raw || "").toLowerCase();
        for (const word of FRAMEWORK_HINT_WORDS) {
            if (text.includes(word)) {
                hits.add(word);
            }
        }
    }
    return [...hits.values()];
}

function safeGetDeclaringFilePath(cls: ArkMainClassLike): string | undefined {
    const file = cls.getDeclaringArkFile?.();
    return file?.getFilePath?.() || file?.getName?.() || undefined;
}

function sortCandidates(candidates: ArkMainExternalEntryCandidate[]): ArkMainExternalEntryCandidate[] {
    return [...candidates].sort((left, right) => {
        const scoreDiff = scoreCandidate(right) - scoreCandidate(left);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }
        return left.methodSignature.localeCompare(right.methodSignature);
    });
}

function scoreCandidate(candidate: ArkMainExternalEntryCandidate): number {
    return candidate.ownerSignals.length * 3
        + candidate.overrideSignals.length * 2
        + candidate.frameworkSignals.length;
}
