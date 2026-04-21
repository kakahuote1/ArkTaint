import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface ChannelBoundaryReport {
    generatedAt: string;
    sourceDir: string;
    factKinds: string[];
    edgeKinds: string[];
    sourceRuleFamilies: string[];
    routerFactCount: number;
    routerEdgeCount: number;
    routerSourceRuleCount: number;
    verdict: string;
}

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

function main(): void {
    const sourceDir = path.resolve("tests/demo/harmony_router_bridge");
    const outputDir = path.resolve("tmp/test_runs/entry_model/channel_provenance_probe/latest");
    ensureDir(outputDir);

    const scene = buildScene(sourceDir);
    const plan = buildArkMainPlan(scene);

    const routerFactCount = plan.facts.filter(fact => {
        const kind = String(fact.kind);
        return kind === "router_source" || kind === "router_trigger";
    }).length;
    const routerEdgeCount = plan.activationGraph.edges.filter(edge => String(edge.kind) === "router_channel").length;
    const routerSourceRuleCount = plan.sourceRules.filter(rule =>
        String(rule.id || "").startsWith("source.arkmain.contract.router.trigger."),
    ).length;

    if (routerFactCount !== 0) {
        throw new Error(`ArkMain should not retain router facts. actual=${routerFactCount}`);
    }
    if (routerEdgeCount !== 0) {
        throw new Error(`ArkMain should not retain router_channel edges. actual=${routerEdgeCount}`);
    }
    if (routerSourceRuleCount !== 0) {
        throw new Error(`ArkMain should not retain router source rules. actual=${routerSourceRuleCount}`);
    }

    const report: ChannelBoundaryReport = {
        generatedAt: new Date().toISOString(),
        sourceDir,
        factKinds: [...new Set(plan.facts.map(fact => fact.kind))].sort(),
        edgeKinds: [...new Set(plan.activationGraph.edges.map(edge => edge.kind))].sort(),
        sourceRuleFamilies: [...new Set(plan.sourceRules.map(rule => String(rule.family || "")))].sort(),
        routerFactCount,
        routerEdgeCount,
        routerSourceRuleCount,
        verdict: "ArkMain no longer owns router channel provenance.",
    };

    const outputPath = path.join(outputDir, "channel_provenance_probe_report.json");
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`report=${outputPath}`);
    console.log("PASS test_entry_model_channel_provenance_probe");
}

main();
