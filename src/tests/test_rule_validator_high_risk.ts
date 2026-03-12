import { validateRuleSet } from "../core/rules/RuleValidator";
import { SinkRule } from "../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function buildRuleSetWithSink(sinkRule: SinkRule) {
    return {
        schemaVersion: "1.1",
        sources: [
            {
                id: "source.min.entry_param",
                kind: "entry_param",
                target: "arg0",
                targetRef: { endpoint: "arg0" },
                match: { kind: "local_name_regex", value: "^taint_src$" },
            },
        ],
        sinks: [sinkRule],
        transfers: [
            {
                id: "transfer.min.bridge",
                match: { kind: "method_name_equals", value: "Bridge" },
                from: "arg0",
                to: "result",
            },
        ],
    };
}

function hasHighRiskWarning(warnings: string[]): boolean {
    return warnings.some(w =>
        w.includes("high-risk method_name_equals")
        && w.includes("combined constraints")
    );
}

function main(): void {
    const baseSink: Omit<SinkRule, "id"> = {
        profile: "signature",
        sinkTarget: "arg0",
        sinkTargetRef: { endpoint: "arg0" },
        match: { kind: "method_name_equals", value: "request" },
    };

    const missingScope: SinkRule = {
        id: "sink.highrisk.missing_scope",
        ...baseSink,
        invokeKind: "instance",
    };
    const onlyScope: SinkRule = {
        id: "sink.highrisk.only_scope",
        ...baseSink,
        scope: {
            className: { mode: "contains", value: "Http" },
        },
    };
    const combinedOk: SinkRule = {
        id: "sink.highrisk.combined_ok",
        ...baseSink,
        invokeKind: "instance",
        argCount: 2,
        scope: {
            className: { mode: "contains", value: "Http" },
        },
    };

    const v1 = validateRuleSet(buildRuleSetWithSink(missingScope));
    assert(v1.valid, `missingScope rule set should remain valid: ${v1.errors.join("; ")}`);
    assert(
        hasHighRiskWarning(v1.warnings),
        `missingScope should trigger high-risk combined warning; got warnings=${JSON.stringify(v1.warnings)}`
    );

    const v2 = validateRuleSet(buildRuleSetWithSink(onlyScope));
    assert(v2.valid, `onlyScope rule set should remain valid: ${v2.errors.join("; ")}`);
    assert(
        hasHighRiskWarning(v2.warnings),
        `onlyScope should trigger high-risk combined warning; got warnings=${JSON.stringify(v2.warnings)}`
    );

    const v3 = validateRuleSet(buildRuleSetWithSink(combinedOk));
    assert(v3.valid, `combinedOk rule set should remain valid: ${v3.errors.join("; ")}`);
    assert(
        !hasHighRiskWarning(v3.warnings),
        `combinedOk should not trigger high-risk combined warning; got warnings=${JSON.stringify(v3.warnings)}`
    );

    console.log("====== Rule Validator High-Risk Gate Test ======");
    console.log(`case_missing_scope_warning=true`);
    console.log(`case_only_scope_warning=true`);
    console.log(`case_combined_ok_warning=false`);
}

main();
