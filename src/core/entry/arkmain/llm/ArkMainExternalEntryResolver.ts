import { ArkMainEntryFact } from "../ArkMainTypes";
import { ArkMainExternalEntryRecognition } from "./ArkMainExternalEntryTypes";

export interface ResolveExternalEntryMethodsOptions {
    minConfidence?: number;
}

export interface ResolveExternalEntryFactsOptions extends ResolveExternalEntryMethodsOptions {
    reasonPrefix?: string;
    recognitionLayer?: string;
    entryShape?: string;
}

type ArkMainMethod = ArkMainEntryFact["method"];
type ArkMainSceneLike = {
    getClasses(): Array<{
        getMethods(): ArkMainMethod[];
    }>;
};

export function resolveExternalEntryMethods(
    scene: ArkMainSceneLike,
    recognitions: ArkMainExternalEntryRecognition[],
    options: ResolveExternalEntryMethodsOptions = {},
): ArkMainMethod[] {
    const minConfidence = options.minConfidence ?? 0.85;
    const methodBySignature = buildMethodBySignature(scene);
    const out = new Map<string, ArkMainMethod>();

    for (const recognition of recognitions) {
        if (!recognition.isEntry) {
            continue;
        }
        if (recognition.confidence < minConfidence) {
            continue;
        }

        const method = methodBySignature.get(recognition.methodSignature);
        if (!method) {
            continue;
        }

        out.set(recognition.methodSignature, method);
    }

    return [...out.values()];
}

export function resolveExternalEntryFacts(
    scene: ArkMainSceneLike,
    recognitions: ArkMainExternalEntryRecognition[],
    options: ResolveExternalEntryFactsOptions = {},
): ArkMainEntryFact[] {
    const minConfidence = options.minConfidence ?? 0.92;
    const reasonPrefix = options.reasonPrefix ?? "[llm external entry]";
    const recognitionLayer = options.recognitionLayer ?? "llm_external_framework_inference";
    const entryShape = options.entryShape ?? "external_llm_inferred";

    const methodBySignature = buildMethodBySignature(scene);
    const out = new Map<string, ArkMainEntryFact>();

    for (const recognition of recognitions) {
        if (!recognition.isEntry) {
            continue;
        }
        if (recognition.confidence < minConfidence) {
            continue;
        }
        if (!recognition.phase || !recognition.kind) {
            continue;
        }

        const method = methodBySignature.get(recognition.methodSignature);
        if (!method) {
            continue;
        }

        const fact: ArkMainEntryFact = {
            phase: recognition.phase,
            kind: recognition.kind,
            method,
            reason: `${reasonPrefix} ${recognition.reason}`,
            entryFamily: recognition.kind,
            entryShape,
            recognitionLayer,
        };

        out.set(recognition.methodSignature, fact);
    }

    return [...out.values()].sort((left, right) => {
        const leftSig = left.method.getSignature?.()?.toString?.() || "";
        const rightSig = right.method.getSignature?.()?.toString?.() || "";
        return leftSig.localeCompare(rightSig);
    });
}

function buildMethodBySignature(scene: ArkMainSceneLike): Map<string, ArkMainMethod> {
    const out = new Map<string, ArkMainMethod>();

    for (const cls of scene.getClasses()) {
        for (const method of cls.getMethods()) {
            const signature = method.getSignature?.()?.toString?.();
            if (!signature || out.has(signature)) {
                continue;
            }
            out.set(signature, method);
        }
    }

    return out;
}
