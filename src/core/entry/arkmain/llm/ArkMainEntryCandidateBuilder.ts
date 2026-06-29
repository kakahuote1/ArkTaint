import type { ModifierType } from "../../../../../arkanalyzer/out/src/core/model/ArkBaseModel";
import type { ArkMainEntryFact } from "../ArkMainTypes";
import {
    collectFrameworkManagedOwners,
} from "../facts/ArkMainOwnerDiscovery";
import {
    collectSdkOverrideCandidates,
} from "../facts/ArkMainStructuralDiscovery";
import { arkanalyzerMethodKeyFromArkMethod } from "../facts/ArkMainArkanalyzerMethodKey";
import {
    resolveArkMainOfficialLifecycleDeclarationsByMethodKey,
    resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod,
} from "../catalog/ArkMainOfficialDeclarationCatalog";
import { ArkMainEntryCandidate } from "./ArkMainEntryCandidateTypes";

export interface BuildArkMainEntryCandidateOptions {
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

export function buildArkMainEntryCandidates(
    scene: ArkMainSceneLike,
    options: BuildArkMainEntryCandidateOptions = {},
): ArkMainEntryCandidate[] {
    const maxCandidates = options.maxCandidates ?? 32;
    const out: ArkMainEntryCandidate[] = [];
    const seen = new Set<string>();
    const managedOwners = collectFrameworkManagedOwners(scene as never);
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
): ArkMainEntryCandidate | null {
    const className = String(cls.getName?.() || "");
    const superClassName = String(cls.getSuperClass?.()?.getName?.() || cls.getSuperClassName?.() || "");
    const filePath = safeGetDeclaringFilePath(cls);
    const parameterTypes = (method.getParameters?.() || [])
        .map((param: any) => String(param?.getType?.()?.toString?.() || ""))
        .filter(Boolean);
    const returnType = String(method.getReturnType?.()?.toString?.() || "") || undefined;
    const isOverride = Boolean(method.containsModifier?.(8192 as ModifierType));
    const ownerEvidenceSignals = managedOwners
        .getEvidences(cls as never)
        .map(evidence => `${evidence.ownerKind}:${evidence.recognitionLayer}`);
    const ownerSignals = ownerEvidenceSignals.map(signal => `owner_contract:${signal}`);
    if (isSyntheticDefaultOwner(className)) {
        return null;
    }
    const overrideSignals = [
        ...(isOverride ? ["override:explicit"] : []),
        ...(sdkOverrideCandidate?.baseClass?.getName?.()
            ? [`override:sdk_base_class:${sdkOverrideCandidate.baseClass.getName()}`]
            : []),
        ...(sdkOverrideCandidate?.baseMethod?.getName?.()
            ? [`override:sdk_base_method:${sdkOverrideCandidate.baseMethod.getName()}`]
            : []),
    ];
    const officialDeclarationSignals = collectOfficialDeclarationSignals(
        methodName,
        ownerEvidenceSignals,
        sdkOverrideCandidate,
    );

    if (ownerSignals.length === 0 || officialDeclarationSignals.length === 0) {
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
        frameworkSignals: officialDeclarationSignals,
    };
}

function isEligibleMethod(method: ArkMainMethod): boolean {
    const name = String(method.getName?.() || "").toLowerCase();
    if (name === "constructor" || name.includes("instinit") || name.startsWith("%")) {
        return false;
    }
    if (method.isStatic?.() || method.isPrivate?.()) {
        return false;
    }
    if (method.isGenerated?.() || method.isAnonymousMethod?.()) {
        return false;
    }
    return true;
}

function safeGetDeclaringFilePath(cls: ArkMainClassLike): string | undefined {
    const file = cls.getDeclaringArkFile?.();
    return file?.getFilePath?.() || file?.getName?.() || undefined;
}

function collectOfficialDeclarationSignals(
    methodName: string,
    ownerEvidenceSignals: string[],
    sdkOverrideCandidate?: ReturnType<typeof collectSdkOverrideCandidates>[number],
): string[] {
    const out = new Set<string>();
    for (const ownerKind of ownerKindsFromEvidenceSignals(ownerEvidenceSignals)) {
        for (const declaration of resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod(ownerKind, methodName)) {
            out.add(officialDeclarationSignal(declaration.canonicalApiId, declaration.templateId));
        }
    }
    for (const declaration of sdkOverrideCandidate?.officialDeclarations || []) {
        out.add(officialDeclarationSignal(declaration.canonicalApiId, declaration.templateId));
    }
    const baseMethodKey = sdkOverrideCandidate?.baseMethod
        ? arkanalyzerMethodKeyFromArkMethod(sdkOverrideCandidate.baseMethod)
        : undefined;
    if (baseMethodKey) {
        for (const declaration of resolveArkMainOfficialLifecycleDeclarationsByMethodKey(baseMethodKey)) {
            out.add(officialDeclarationSignal(declaration.canonicalApiId, declaration.templateId));
        }
    }
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function ownerKindsFromEvidenceSignals(signals: string[]): string[] {
    const out = new Set<string>();
    for (const signal of signals) {
        const separatorIndex = signal.indexOf(":");
        const ownerKind = separatorIndex >= 0 ? signal.slice(0, separatorIndex) : signal;
        if (ownerKind) {
            out.add(ownerKind);
        }
    }
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function officialDeclarationSignal(canonicalApiId: string, templateId: string): string {
    return `official_declaration:${canonicalApiId}:${templateId}`;
}

function isSyntheticDefaultOwner(className: string): boolean {
    const normalized = String(className || "").trim().toLowerCase();
    return normalized === "%dflt" || normalized === "dflt" || normalized === "default";
}

function sortCandidates(candidates: ArkMainEntryCandidate[]): ArkMainEntryCandidate[] {
    return [...candidates].sort((left, right) => {
        const scoreDiff = scoreCandidate(right) - scoreCandidate(left);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }
        return left.methodSignature.localeCompare(right.methodSignature);
    });
}

function scoreCandidate(candidate: ArkMainEntryCandidate): number {
    return candidate.ownerSignals.length * 3
        + candidate.overrideSignals.length * 2
        + candidate.frameworkSignals.length;
}
