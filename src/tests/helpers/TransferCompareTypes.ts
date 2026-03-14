import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";

export type PerfMode = "arktaint" | "arktan";

export interface CliOptions {
    rounds: number;
    k: number;
    outputDir: string;
    defaultRulePath: string;
    arktanRoot: string;
    runStability: boolean;
    arktaintEnableProfile: boolean;
}

export interface ScenarioConfig {
    id: string;
    sourceDir: string;
    projectRulePath: string;
}

export interface CaseResult {
    caseName: string;
    expected: boolean;
    detected: boolean;
    pass: boolean;
}

export interface TransferCandidate {
    id: string;
    matchKind: string;
    matchValue: string;
    invokeKind?: string;
    argCount?: number;
    typeHint?: string;
    scope?: Record<string, unknown>;
    from: string;
    to: string;
}

export interface ScenarioStaticData {
    config: ScenarioConfig;
    scene: Scene;
    caseNames: string[];
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
    transferRules: TransferRule[];
    transferCandidates: TransferCandidate[];
    droppedTransferRules: {
        id: string;
        reason: string;
    }[];
    sinkMethodName: string;
}

export interface RoundTiming {
    round: number;
    wallElapsedMs: number;
    transferElapsedMs?: number;
}

export interface ScenarioRunReport {
    scenarioId: string;
    totalCases: number;
    passCases: number;
    fp: number;
    fn: number;
    caseResults: CaseResult[];
    rounds: RoundTiming[];
    metadata?: Record<string, unknown>;
}

export interface ToolReport {
    tool: PerfMode;
    totalCases: number;
    passCases: number;
    fp: number;
    fn: number;
    perScenario: ScenarioRunReport[];
    medianWallMs: number;
    medianTransferMs?: number;
}

export interface StabilityCheck {
    name: string;
    command: string;
    status: "pass" | "fail" | "skipped";
    elapsedMs: number;
    code: number | null;
}

export interface CompareReport {
    generatedAt: string;
    options: {
        rounds: number;
        k: number;
        ruleSchemaVersion: string;
        defaultRulePath: string;
        arktanRoot: string;
        runStability: boolean;
    };
    environment: {
        node: string;
        platform: string;
        cpus: number;
        host: string;
    };
    scenarios: Array<{
        id: string;
        sourceDir: string;
        projectRulePath: string;
        caseCount: number;
        droppedTransferRules: number;
    }>;
    precision: {
        arktaint: { fp: number; fn: number };
        arktan: { fp: number; fn: number };
        pass: boolean;
        reason: string;
    };
    performance: {
        arktaintMedianTransferMs: number;
        arktaintMedianWallMs: number;
        arktanMedianWallMs: number;
        pass: boolean;
        reason: string;
    };
    usability: {
        integrationSteps: string[];
        stepCount: number;
        pass: boolean;
        reason: string;
    };
    stability: {
        checks: StabilityCheck[];
        pass: boolean;
        reason: string;
    };
    artifacts: {
        jsonPath: string;
        markdownPath: string;
    };
    details: {
        arktaint: ToolReport;
        arktan: ToolReport;
    };
    finalDecision: {
        pass: boolean;
        reason: string;
    };
}

export interface ArktanRunnerReport {
    elapsedMs: number;
    flowCount: number;
    detectedCases: string[];
    generatedRules: {
        sourceCount: number;
        sinkCount: number;
        transferCount: number;
    };
    missingCaseMethods: string[];
}

export const DEFAULT_TRANSFER_COMPARE_SCENARIOS: ScenarioConfig[] = [
    {
        id: "rule_transfer",
        sourceDir: "tests/demo/rule_transfer",
        projectRulePath: "tests/rules/transfer_only.rules.json",
    },
    {
        id: "rule_transfer_variants",
        sourceDir: "tests/demo/rule_transfer_variants",
        projectRulePath: "tests/rules/transfer_variants.rules.json",
    },
    {
        id: "rule_precision_transfer",
        sourceDir: "tests/demo/rule_precision_transfer",
        projectRulePath: "tests/rules/transfer_precision.rules.json",
    },
    {
        id: "transfer_overload_conflicts",
        sourceDir: "tests/demo/transfer_overload_conflicts",
        projectRulePath: "tests/rules/transfer_overload_conflicts.rules.json",
    },
    {
        id: "transfer_priority",
        sourceDir: "tests/demo/transfer_priority",
        projectRulePath: "tests/rules/transfer_priority.rules.json",
    },
];

export const DEFAULT_INTEGRATION_STEPS: string[] = [
    "Prepare project.rules.json for target project (no edits under src/core/**).",
    "Run analyze command with --projectRules and --repo.",
    "Read JSON/Markdown report and triage findings.",
];
