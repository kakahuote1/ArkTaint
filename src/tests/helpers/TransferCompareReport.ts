import { CompareReport } from "./TransferCompareTypes";

export function renderTransferCompareMarkdown(report: CompareReport): string {
    const lines: string[] = [];
    lines.push("# Phase 5.5 Transfer Compare Report (ArkTaint vs Arktan)");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- node: ${report.environment.node}`);
    lines.push(`- platform: ${report.environment.platform}`);
    lines.push(`- rounds: ${report.options.rounds}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- ruleSchemaVersion: ${report.options.ruleSchemaVersion}`);
    lines.push(`- defaultRulePath: ${report.options.defaultRulePath}`);
    lines.push(`- arktanRoot: ${report.options.arktanRoot}`);
    lines.push("");
    lines.push("## Precision");
    lines.push(`- ArkTaint: FP=${report.precision.arktaint.fp}, FN=${report.precision.arktaint.fn}`);
    lines.push(`- Arktan: FP=${report.precision.arktan.fp}, FN=${report.precision.arktan.fn}`);
    lines.push(`- pass: ${report.precision.pass}`);
    lines.push(`- reason: ${report.precision.reason}`);
    lines.push("");
    lines.push("## Performance");
    lines.push(`- ArkTaint median transfer ms: ${report.performance.arktaintMedianTransferMs.toFixed(3)}`);
    lines.push(`- ArkTaint median wall ms: ${report.performance.arktaintMedianWallMs.toFixed(3)}`);
    lines.push(`- Arktan median wall ms: ${report.performance.arktanMedianWallMs.toFixed(3)}`);
    lines.push(`- pass: ${report.performance.pass}`);
    lines.push(`- reason: ${report.performance.reason}`);
    lines.push("");
    lines.push("## Usability");
    lines.push(`- stepCount: ${report.usability.stepCount}`);
    lines.push(`- pass: ${report.usability.pass}`);
    lines.push(`- reason: ${report.usability.reason}`);
    for (const s of report.usability.integrationSteps) {
        lines.push(`- step: ${s}`);
    }
    lines.push("");
    lines.push("## Stability");
    lines.push(`- pass: ${report.stability.pass}`);
    lines.push(`- reason: ${report.stability.reason}`);
    for (const c of report.stability.checks) {
        lines.push(`- ${c.name}: status=${c.status}, elapsedMs=${c.elapsedMs.toFixed(1)}, code=${c.code}`);
    }
    lines.push("");
    lines.push("## Final Decision");
    lines.push(`- pass: ${report.finalDecision.pass}`);
    lines.push(`- reason: ${report.finalDecision.reason}`);
    lines.push("");
    lines.push("## Scenarios");
    for (const s of report.scenarios) {
        lines.push(`- ${s.id}: sourceDir=${s.sourceDir}, projectRulePath=${s.projectRulePath}, caseCount=${s.caseCount}, droppedTransferRules=${s.droppedTransferRules}`);
    }
    return lines.join("\n");
}

export function buildTransferCompareDecision(report: CompareReport): { pass: boolean; reason: string } {
    if (!report.precision.pass) {
        return { pass: false, reason: "precision_threshold_not_met" };
    }
    if (!report.performance.pass) {
        return { pass: false, reason: "performance_threshold_not_met" };
    }
    if (!report.usability.pass) {
        return { pass: false, reason: "usability_threshold_not_met" };
    }
    if (!report.stability.pass) {
        return { pass: false, reason: "stability_threshold_not_met" };
    }
    return { pass: true, reason: "all_thresholds_passed" };
}
