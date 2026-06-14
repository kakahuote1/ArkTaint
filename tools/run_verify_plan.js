#!/usr/bin/env node

const { spawnSync } = require("child_process");

const FAST = [
    "build",
    "test:asset-schema-v2",
    "test:kernel-official-asset-governance",
    "test:official-api-coverage-gate",
    "test:official-semantics-precision-gate",
    "test:semanticflow-known-rule-candidates",
    "test:semanticflow-project-callback-candidates",
    "test:semanticflow-project-api-modeling-contract",
    "test:no-candidate-api-modeling-pool",
];

const CORE = [
    ...FAST,
    "test:layer-dependency-gate",
    "test:architecture-hygiene-gate",
    "test:asset-registry-bootstrap",
    "test:asset-coverage-ledger",
    "test:preanalysis-evidence-pack",
    "test:asset-promotion-gate",
    "test:cellkind-registry-dynamic",
    "test:asset-surface-registry",
    "test:semantic-runtime-rule-effects",
    "test:rule-asset-lowering",
    "test:rule-free-function-surface-selector",
    "test:rule-promise-result-source",
    "test:rule-assets-v2-schema",
    "test:module-assets-v2-schema",
    "test:arkmain-assets-v2-schema",
    "test:semanticflow-artifact-ids",
    "test:semanticflow-asset-model-output",
    "test:semanticflow-llm-repair",
    "test:semanticflow-provider-circuit",
    "test:semanticflow-request-payload-endpoint-contract",
    "test:callback-field-name-source-rule",
    "test:semanticflow-evidence-pack-contract",
    "test:semanticflow-evaluation-overlay-policy",
    "test:handoff-effect-consumer-v2",
    "test:rule-governance",
    "test:source-exact",
    "test:sink-exact",
    "test:transfer-exact",
    "test:module-runtime",
    "test:internal-module-lowering-ir-engine",
    "test:module-semantic-edge-suite",
    "test:engine-plugin-runtime",
    "test:full-analysis-stage-boundary",
    "test:algorithm-validation",
    "test:provenance-path-recorder",
    "test:provenance-evidence-graph-boundary",
    "test:kernel-guard",
    "test:algorithm-e-oclfs",
    "test:handoff-sensitive-propagation",
    "test:execution-handoff-necessity",
    "test:entry-model",
    "test:analyze-single-command",
    "test:analyze-guidance",
    "test:full-trace-graph",
    "test:analyze-budget-truncation",
    "test:analyze-object-container-sibling-field-precision",
    "test:analyze-unresolved-this-field-fallback-scope",
    "test:analyze-materialized-taint-flows",
    "test:analyze-materialized-taint-flow-branching",
    "test:analyze-type-narrowing-guard",
    "test:analyze-type-narrowing-guard-partial-path-survival",
    "test:analyze-path-guard-literal-conflict",
    "test:analyze-path-guard-reassignment-survival",
    "test:analyze-postsolve-path-judgement-divergence",
    "test:postsolve-scoped-evidence-contract",
    "test:analyze-suppressed-flows",
    "test:analyze-safe-overwrite-suppressed",
    "test:analyze-safe-overwrite-partial-path-survival",
    "test:analyze-parameterized-query-refinement",
    "test:analyze-sanitizer-postsolve-refinement",
    "test:analyze-kernel-sanitizer-catalog",
    "test:analyze-delete-before-read-refinement",
    "test:analyze-keyed-route-callback-mismatch-suppressed",
    "test:analyze-keyed-route-callback-match-live",
    "test:analyze-module-cli",
    "test:analyze-module-inspection-cli",
    "test:analyze-plugin-inspection-cli",
    "test:analyze-engine-plugin-cli",
    "test:analyze-incremental",
    "test:analyze-invalid-flags",
];

const OFFICIAL = [
    "build",
    "test:kernel-official-asset-governance",
    "test:official-api-coverage-gate",
    "test:official-structured-transfer-assets",
    "test:official-form-ui-asset-coverage",
    "test:official-kv-picker-asset-coverage",
    "test:official-module-semantic-slots",
    "test:module-handoff-effect-asset-lowering",
    "test:official-semantics-precision-gate",
];

const CAPABILITY = [
    "test:ordinary-language-core",
    "test:capability-pack-b",
    "test:capability-pack-c",
    "test:capability-pack-d",
    "test:capability-pack-e",
];

const PLANS = {
    fast: FAST,
    core: CORE,
    official: OFFICIAL,
    capability: CAPABILITY,
    full: [...CORE, ...OFFICIAL.slice(1), ...CAPABILITY],
};

function formatElapsed(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}

function runNpmScript(script) {
    if (process.platform === "win32") {
        return spawnSync(
            "cmd.exe",
            ["/d", "/s", "/c", "npm", "run", script],
            {
                stdio: "inherit",
                env: process.env,
            },
        );
    }

    return spawnSync(
        "npm",
        ["run", script],
        {
            stdio: "inherit",
            env: process.env,
        },
    );
}

function main() {
    if (process.argv[2] === "--list") {
        for (const [name, plan] of Object.entries(PLANS)) {
            console.log(`[verify:${name}] steps=${plan.length}`);
            plan.forEach((script, index) => console.log(`${index + 1}. ${script}`));
        }
        return;
    }

    const planName = process.argv[2] || "core";
    const plan = PLANS[planName];
    if (!plan) {
        console.error(`unknown verify plan '${planName}'`);
        console.error(`available plans: ${Object.keys(PLANS).join(", ")}`);
        process.exit(2);
    }

    const totalStartedAt = Date.now();
    console.log(`[verify:${planName}] steps=${plan.length}`);
    for (let i = 0; i < plan.length; i++) {
        const script = plan[i];
        const startedAt = Date.now();
        console.log(`[verify:${planName}] ${i + 1}/${plan.length} npm run ${script}`);
        const result = runNpmScript(script);
        const elapsed = Date.now() - startedAt;
        if (result.error || result.status !== 0) {
            if (result.error) {
                console.error(`[verify:${planName}] spawn_error step=${script} message=${result.error.message}`);
            }
            console.error(`[verify:${planName}] failed step=${script} status=${result.status} elapsed=${formatElapsed(elapsed)}`);
            process.exit(result.status || 1);
        }
        console.log(`[verify:${planName}] passed step=${script} elapsed=${formatElapsed(elapsed)}`);
    }
    console.log(`[verify:${planName}] passed total_elapsed=${formatElapsed(Date.now() - totalStartedAt)}`);
}

main();
