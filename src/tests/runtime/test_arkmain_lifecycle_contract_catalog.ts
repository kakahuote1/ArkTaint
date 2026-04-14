import {
    resolveAbilityLifecycleContract,
    resolveComponentLifecycleContract,
    resolveStageLifecycleContract,
} from "../../core/entry/arkmain/facts/ArkMainLifecycleContracts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const ability = resolveAbilityLifecycleContract("onCreate");
    const stage = resolveStageLifecycleContract("onDestroy");
    const component = resolveComponentLifecycleContract("build");

    assert(ability?.phase === "bootstrap", `unexpected ability phase: ${ability?.phase}`);
    assert(ability?.kind === "ability_lifecycle", `unexpected ability kind: ${ability?.kind}`);
    assert(stage?.phase === "teardown", `unexpected stage phase: ${stage?.phase}`);
    assert(stage?.kind === "stage_lifecycle", `unexpected stage kind: ${stage?.kind}`);
    assert(component?.phase === "composition", `unexpected component phase: ${component?.phase}`);
    assert(component?.kind === "page_build", `unexpected component kind: ${component?.kind}`);

    console.log("PASS test_arkmain_lifecycle_contract_catalog");
}

main().catch(error => {
    console.error("FAIL test_arkmain_lifecycle_contract_catalog");
    console.error(error);
    process.exit(1);
});
