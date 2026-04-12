import { buildArkMainPlan, ArkMainPlan } from "./ArkMainPlanner";
import { ArkMainPlanOptions } from "./ArkMainTypes";
import {
    buildArkMainExternalEntryCandidates,
    BuildArkMainExternalEntryCandidateOptions,
} from "./llm/ArkMainExternalEntryCandidateBuilder";
import {
    recognizeExternalArkMainEntries,
    RecognizeExternalArkMainEntriesOptions,
} from "./llm/ArkMainExternalEntryRecognizer";
import {
    resolveExternalEntryFacts,
    resolveExternalEntryMethods,
    ResolveExternalEntryFactsOptions,
    ResolveExternalEntryMethodsOptions,
} from "./llm/ArkMainExternalEntryResolver";
import {
    ArkMainExternalEntryCandidate,
    ArkMainExternalEntryRecognition,
} from "./llm/ArkMainExternalEntryTypes";

type ArkMainMethod = ArkMainPlanOptions["seedMethods"] extends Array<infer T> ? T : never;

type ArkMainSceneLike = {
    getClasses(): Array<{
        getMethods(): ArkMainMethod[];
    }>;
};

export interface BuildArkMainPlanWithExternalEntriesOptions
    extends ArkMainPlanOptions,
        BuildArkMainExternalEntryCandidateOptions,
        RecognizeExternalArkMainEntriesOptions {
    methodResolveOptions?: ResolveExternalEntryMethodsOptions;
    factResolveOptions?: ResolveExternalEntryFactsOptions;
    enableExternalEntryFacts?: boolean;
}

export interface ArkMainPlanWithExternalEntriesResult {
    plan: ArkMainPlan;
    candidates: ArkMainExternalEntryCandidate[];
    recognitions: ArkMainExternalEntryRecognition[];
    externalEntryCandidates: ArkMainMethod[];
    externalEntryFacts: ArkMainPlanOptions["externalEntryFacts"];
}

export async function buildArkMainPlanWithExternalEntries(
    scene: ArkMainSceneLike,
    options: BuildArkMainPlanWithExternalEntriesOptions = {},
): Promise<ArkMainPlanWithExternalEntriesResult> {
    const candidates = buildArkMainExternalEntryCandidates(scene as never, {
        maxCandidates: options.maxCandidates,
    });

    const recognitions = await recognizeExternalArkMainEntries(candidates, {
        maxCandidates: options.maxCandidates,
        minConfidence: options.minConfidence,
        batchSize: options.batchSize,
        enableCache: options.enableCache,
        cachePath: options.cachePath,
        model: options.model,
        modelInvoker: options.modelInvoker,
    });

    const externalEntryCandidates = resolveExternalEntryMethods(
        scene,
        recognitions,
        options.methodResolveOptions || {
            minConfidence: options.minConfidence ?? 0.85,
        },
    );

    const externalEntryFacts = options.enableExternalEntryFacts
        ? resolveExternalEntryFacts(
            scene,
            recognitions,
            options.factResolveOptions || {
                minConfidence: Math.max(options.minConfidence ?? 0.85, 0.92),
            },
        )
        : (options.externalEntryFacts || []);

    const plan = buildArkMainPlan(scene as never, {
        ...options,
        externalEntryCandidates: dedupeMethods([
            ...(options.externalEntryCandidates || []),
            ...externalEntryCandidates,
        ]),
        externalEntryFacts: dedupeFacts([
            ...(options.externalEntryFacts || []),
            ...externalEntryFacts,
        ]),
    });

    return {
        plan,
        candidates,
        recognitions,
        externalEntryCandidates,
        externalEntryFacts,
    };
}

function dedupeMethods(methods: ArkMainMethod[]): ArkMainMethod[] {
    const out = new Map<string, ArkMainMethod>();

    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) {
            continue;
        }
        out.set(signature, method);
    }

    return [...out.values()];
}

function dedupeFacts(
    facts: NonNullable<ArkMainPlanOptions["externalEntryFacts"]>,
): NonNullable<ArkMainPlanOptions["externalEntryFacts"]> {
    const out = new Map<string, NonNullable<ArkMainPlanOptions["externalEntryFacts"]>[number]>();

    for (const fact of facts) {
        const signature = fact.method?.getSignature?.()?.toString?.();
        if (!signature) {
            continue;
        }
        const key = `${fact.phase}|${fact.kind}|${signature}`;
        if (out.has(key)) {
            continue;
        }
        out.set(key, fact);
    }

    return [...out.values()];
}