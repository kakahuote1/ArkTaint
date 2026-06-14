import { splitArkMainEntryCandidatesForSemanticFlow } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateFilter";
import type { ArkMainEntryCandidate } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function candidate(args: {
    className: string;
    methodName: string;
    ownerSignals: string[];
    superClassName?: string;
    overrideSignals?: string[];
}): ArkMainEntryCandidate {
    return {
        method: {
            getName: () => args.methodName,
            getSignature: () => ({ toString: () => `${args.className}.${args.methodName}()` }),
        } as any,
        methodSignature: `${args.className}.${args.methodName}()`,
        className: args.className,
        methodName: args.methodName,
        filePath: `${args.className}.ets`,
        superClassName: args.superClassName,
        parameterTypes: [],
        isOverride: Boolean(args.overrideSignals?.length),
        ownerSignals: args.ownerSignals,
        overrideSignals: args.overrideSignals || [],
        frameworkSignals: [],
    };
}

function main(): void {
    const abilityLifecycle = candidate({
        className: "DemoAbility",
        methodName: "onCreate",
        superClassName: "UIAbility",
        ownerSignals: ["owner_contract:ability_owner:base_class"],
        overrideSignals: ["override:explicit"],
    });
    const projectComponentBuild = candidate({
        className: "LibraryChatView",
        methodName: "build",
        ownerSignals: ["owner_contract:component_owner:decorator"],
    });
    const projectComponentCustom = candidate({
        className: "LibraryChatView",
        methodName: "sendMessage",
        ownerSignals: ["owner_contract:component_owner:decorator"],
    });

    const split = splitArkMainEntryCandidatesForSemanticFlow([
        abilityLifecycle,
        projectComponentBuild,
        projectComponentCustom,
    ]);

    assert(
        split.kernelCoveredCandidates.some(item => item.className === "DemoAbility" && item.methodName === "onCreate"),
        "official ability lifecycle should stay covered by kernel contracts",
    );
    assert(
        split.semanticFlowCandidates.some(item => item.className === "LibraryChatView" && item.methodName === "build"),
        "project component build should enter SemanticFlow instead of being assumed kernel-covered",
    );
    assert(
        split.ineligibleCandidates.some(item => item.className === "LibraryChatView" && item.methodName === "sendMessage"),
        "non-lifecycle project component methods should remain ineligible as arkmain entries",
    );

    console.log("PASS test_arkmain_candidate_filter");
}

main();
