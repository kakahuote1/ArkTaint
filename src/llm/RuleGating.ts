import { TaintRuleSet } from "../core/rules/RuleSchema";

const HIGH_RISK_METHOD_NAMES = new Set(["get", "set", "update", "request", "on"]);

function hasScopeAnchor(scope: any): boolean {
    return Boolean(scope?.file || scope?.module || scope?.className || scope?.methodName);
}

function gateRule(rule: any): any {
    if (!rule || !rule.match) {
        return { ...rule, enabled: false };
    }
    const matchKind = String(rule.match.kind || "");
    const matchValue = String(rule.match.value || "").trim();

    const scopeAnchored = hasScopeAnchor(rule.scope);
    const invokeKind = rule.match.invokeKind;
    const hasInvokeKind = typeof invokeKind === "string" && invokeKind !== "any" && invokeKind.length > 0;
    const hasArgCount = typeof rule.match.argCount === "number";

    let enabled = rule.enabled !== false;

    // Method-name-only rules must be anchored by scope + shape.
    if ((matchKind === "method_name_equals" || matchKind === "method_name_regex") && !scopeAnchored) {
        enabled = false;
    }
    if ((matchKind === "method_name_equals" || matchKind === "method_name_regex") && (!hasInvokeKind || !hasArgCount)) {
        enabled = false;
    }

    // Conservative disable for generic method names.
    if (matchKind === "method_name_equals") {
        const m = matchValue.toLowerCase();
        if (HIGH_RISK_METHOD_NAMES.has(m)) {
            enabled = false;
        }
    }

    // signature_contains must not be too short.
    if (matchKind === "signature_contains" && matchValue.length < 6) {
        enabled = false;
    }

    // Non-exact signature matching must carry shape constraints to reduce noise.
    if (matchKind !== "signature_equals" && (!hasInvokeKind || !hasArgCount)) {
        enabled = false;
    }

    return { ...rule, enabled };
}

export function applyRuleGatingPolicy(ruleSet: TaintRuleSet): TaintRuleSet {
    return {
        ...ruleSet,
        schemaVersion: "2.0",
        sources: (ruleSet.sources || []).map(gateRule),
        sinks: (ruleSet.sinks || []).map(gateRule),
        sanitizers: (ruleSet.sanitizers || []).map(gateRule),
        transfers: (ruleSet.transfers || []).map(gateRule),
    };
}

