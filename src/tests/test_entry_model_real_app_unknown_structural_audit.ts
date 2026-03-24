import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../core/entry/arkmain/ArkMainPlanner";
import type { ArkMainEntryFact } from "../core/entry/arkmain/ArkMainTypes";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

type AuditClass =
    | "likely_valid_long_tail"
    | "likely_overbroad_internal_async";

interface ReasonAuditRule {
    classification: AuditClass;
    rationale: string;
}

interface ClusterReport {
    reason: string;
    count: number;
    classification: AuditClass;
    rationale: string;
    sampleMethods: string[];
    sampleSourceMethods: string[];
}

interface AuditReport {
    generatedAt: string;
    projectId: string;
    projectRoot: string;
    totalUnknownStructuralCallbacks: number;
    classifiedAsLikelyValid: number;
    classifiedAsLikelyOverbroad: number;
    evidenceFamilyCounts: Record<string, number>;
    clusters: ClusterReport[];
}

const REAL_APP_ROOT = process.env.ARKMAIN_REAL_APP_ROOT || "D:/cursor/workplace/project";
const PROJECT_NAME = process.argv[2] || process.env.ARKMAIN_REAL_APP_PROJECT || "WanAndroidHarmoney";

interface ProjectAuditConfig {
    maxUnknownStructuralCallbacks: number;
    maxLikelyOverbroadInternalAsync: number;
    outputFileName: string;
    reasonAuditRules: Record<string, ReasonAuditRule>;
}

const WANANDROID_REASON_AUDIT_RULES: Record<string, ReasonAuditRule> = {
    "Structural callable fallback: @channel.set has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "Project EventBus wrapper stores callbacks in Map.set but later dispatches them via emitter.on; these are real event callbacks with an imprecise first-layer reason.",
    },
    "Structural callable fallback: ForEach.create has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "ArkUI list/item builder callbacks are framework-driven render callbacks, not pure user helpers.",
    },
    "Structural callable fallback: LazyForEach.create has callable arg(s) at index [1, 2]": {
        classification: "likely_valid_long_tail",
        rationale: "LazyForEach item/key builders are framework-managed callbacks.",
    },
    "Structural callable fallback: @channel.inputFilter has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "InputFilter callback is a framework registration point on TextInput.",
    },
    "Structural callable fallback: @channel.setInterval has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "setInterval callback is a legitimate scheduler entry.",
    },
    "Structural callable fallback: @channel.onReady has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "UI/Web component readiness callbacks are framework-managed entries.",
    },
    "Structural callable fallback: @channel.hypiumTest has callable arg(s) at index [2]": {
        classification: "likely_valid_long_tail",
        rationale: "Hypium test registration callback is framework/test-runtime managed.",
    },
    "Structural callable fallback: @channel.on has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "Emitter.on callback is a real event subscription entry.",
    },
    "Structural callable fallback: @channel.onPageBegin has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web lifecycle callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onPageEnd has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web lifecycle callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onProgressChange has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web progress callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onTitleReceive has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web title callback is framework-managed.",
    },
    "Structural callable fallback: PullToRefresh.onActionUpdate has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Custom component wrapper forwards gesture callbacks into framework gesture registration.",
    },
    "Structural callable fallback: PullToRefresh.onActionEnd has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Custom component wrapper forwards gesture callbacks into framework gesture registration.",
    },
    "Structural callable fallback: CollectedListViewModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "Project async helper returns Promise/new Promise executor callbacks; not framework-triggered roots.",
    },
    "Structural callable fallback: GlobalUserDBModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "DB model helper Promise wrappers are internal async code, not framework entries.",
    },
    "Structural callable fallback: GlobalSettingViewModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "ViewModel Promise wrappers like getAvatar/isShowTopArticle are internal async helpers.",
    },
    "Structural callable fallback: WebViewModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "Internal async helper callback, not a framework registration.",
    },
    "Structural callable fallback: GlobalWanDBViewModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "DB viewmodel async wrapper callback, not framework-triggered.",
    },
    "Structural callable fallback: GlobalSearchHistoryDBModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "Internal Promise/reject wrapper, not a framework entry.",
    },
    "Structural callable fallback: SearchListViewModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "Search viewmodel async wrapper callback, not a framework registration.",
    },
    "Structural callable fallback: ShareViewModel.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "Share viewmodel async wrapper callback, not a framework registration.",
    },
    "Structural callable fallback: SyncSafetyLock.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "Lock helper callback is project-internal async plumbing, not entry discovery.",
    },
    "Structural callable fallback: DBHelper.constructor has callable arg(s) at index [0]": {
        classification: "likely_overbroad_internal_async",
        rationale: "DB helper callback is project-internal Promise plumbing, not a framework entry.",
    },
};

const HARMONYSTUDY_REASON_AUDIT_RULES: Record<string, ReasonAuditRule> = {
    "Structural callable fallback: ForEach.create has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "ArkUI list/item builder callbacks are framework-driven render callbacks, not pure user helpers.",
    },
    "Structural callable fallback: LazyForEach.create has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "LazyForEach item builders are framework-managed render callbacks.",
    },
    "Structural callable fallback: @channel.inputFilter has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "InputFilter callback is a framework registration point on text input widgets.",
    },
    "Structural callable fallback: @channel.onGestureSwipe has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Swipe gesture callback is framework-managed input handling, not project helper code.",
    },
    "Structural callable fallback: @channel.hypiumTest has callable arg(s) at index [2]": {
        classification: "likely_valid_long_tail",
        rationale: "Hypium test registration callback is framework/test-runtime managed.",
    },
    "Structural callable fallback: @channel.getRawFileContent has callable arg(s) at index [1]": {
        classification: "likely_valid_long_tail",
        rationale: "Resource/file async completion callback is a legitimate action-style registration.",
    },
    "Structural callable fallback: @channel.onPageBegin has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web lifecycle callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onPageEnd has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web lifecycle callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onProgressChange has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web progress callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onErrorReceive has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web error callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onHttpErrorReceive has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web HTTP error callback is framework-managed.",
    },
    "Structural callable fallback: @channel.onTitleReceive has callable arg(s) at index [0]": {
        classification: "likely_valid_long_tail",
        rationale: "Web title callback is framework-managed.",
    },
};

const PROJECT_AUDIT_CONFIGS: Record<string, ProjectAuditConfig> = {
    WanAndroidHarmoney: {
        maxUnknownStructuralCallbacks: 55,
        maxLikelyOverbroadInternalAsync: 0,
        outputFileName: "wanandroid_unknown_structural_audit_report.json",
        reasonAuditRules: WANANDROID_REASON_AUDIT_RULES,
    },
    HarmonyStudy: {
        maxUnknownStructuralCallbacks: 24,
        maxLikelyOverbroadInternalAsync: 0,
        outputFileName: "harmonystudy_unknown_structural_audit_report.json",
        reasonAuditRules: HARMONYSTUDY_REASON_AUDIT_RULES,
    },
};

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function signatureOfMethod(method: ArkMainEntryFact["method"] | ArkMainEntryFact["sourceMethod"]): string {
    return method?.getSignature?.()?.toString?.() || "<unknown>";
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const projectConfig = PROJECT_AUDIT_CONFIGS[PROJECT_NAME];
    assert(projectConfig, `missing project audit config for ${PROJECT_NAME}`);
    const projectRoot = path.resolve(REAL_APP_ROOT, PROJECT_NAME);
    assert(fs.existsSync(projectRoot), `real app project not found: ${projectRoot}`);

    const scene = buildScene(projectRoot);
    const plan = buildArkMainPlan(scene);
    const unknownFacts = plan.facts.filter(fact => fact.entryFamily === "unknown_structural_callback");
    const evidenceFamilyCounts = new Map<string, number>();
    for (const fact of unknownFacts) {
        const family = fact.callbackStructuralEvidenceFamily;
        assert(family, `missing structural evidence family for ${signatureOfMethod(fact.method)}`);
        evidenceFamilyCounts.set(family, (evidenceFamilyCounts.get(family) || 0) + 1);
    }

    const clusters = new Map<string, ArkMainEntryFact[]>();
    for (const fact of unknownFacts) {
        const key = fact.reason;
        const bucket = clusters.get(key);
        if (bucket) {
            bucket.push(fact);
        } else {
            clusters.set(key, [fact]);
        }
    }

    const reports: ClusterReport[] = [];
    let classifiedAsLikelyValid = 0;
    let classifiedAsLikelyOverbroad = 0;

    for (const [reason, facts] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const rule = projectConfig.reasonAuditRules[reason];
        assert(rule, `missing audit classification for reason: ${reason}`);
        const count = facts.length;
        if (rule.classification === "likely_valid_long_tail") {
            classifiedAsLikelyValid += count;
        } else {
            classifiedAsLikelyOverbroad += count;
        }
        reports.push({
            reason,
            count,
            classification: rule.classification,
            rationale: rule.rationale,
            sampleMethods: facts.slice(0, 5).map(fact => signatureOfMethod(fact.method)),
            sampleSourceMethods: facts.slice(0, 5).map(fact => signatureOfMethod(fact.sourceMethod)),
        });
    }

    const report: AuditReport = {
        generatedAt: new Date().toISOString(),
        projectId: PROJECT_NAME,
        projectRoot,
        totalUnknownStructuralCallbacks: unknownFacts.length,
        classifiedAsLikelyValid,
        classifiedAsLikelyOverbroad,
        evidenceFamilyCounts: Object.fromEntries([...evidenceFamilyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
        clusters: reports,
    };

    assert(
        report.totalUnknownStructuralCallbacks <= projectConfig.maxUnknownStructuralCallbacks,
        `regression: unknown_structural too many (${report.totalUnknownStructuralCallbacks} > ${projectConfig.maxUnknownStructuralCallbacks})`,
    );
    assert(
        report.classifiedAsLikelyOverbroad <= projectConfig.maxLikelyOverbroadInternalAsync,
        `regression: likely_overbroad_internal_async reappeared (${report.classifiedAsLikelyOverbroad} > ${projectConfig.maxLikelyOverbroadInternalAsync})`,
    );

    const outputDir = path.resolve("tmp/phase717/real_app_unknown_structural_audit");
    const outputPath = path.join(outputDir, projectConfig.outputFileName);
    ensureDir(outputDir);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log("PASS test_entry_model_real_app_unknown_structural_audit");
    console.log(`report=${outputPath}`);
    console.log(`total_unknown_structural_callbacks=${report.totalUnknownStructuralCallbacks}`);
    console.log(`likely_valid_long_tail=${report.classifiedAsLikelyValid}`);
    console.log(`likely_overbroad_internal_async=${report.classifiedAsLikelyOverbroad}`);
    for (const [family, count] of Object.entries(report.evidenceFamilyCounts)) {
        console.log(`evidence_family\t${family}\t${count}`);
    }
    for (const cluster of report.clusters) {
        console.log(`${cluster.count}\t${cluster.classification}\t${cluster.reason}`);
    }
}

main().catch(error => {
    console.error("FAIL test_entry_model_real_app_unknown_structural_audit");
    console.error(error);
    process.exit(1);
});
