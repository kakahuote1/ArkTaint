import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

interface SmokeLabelItem {
    flowCount: number;
    candidateType: string;
    sinkRuleHits: Record<string, number>;
}

interface SmokeLabelFile {
    sampleSizeActual: number;
    items: SmokeLabelItem[];
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function main(): void {
    const outputDir = path.resolve("tmp/test_runs/real_projects/smoke_inventory_alignment/latest");
    fs.rmSync(outputDir, { recursive: true, force: true });
    ensureDir(outputDir);

    const reportPath = path.join(outputDir, "smoke_report.json");
    const labelDateTag = "inventory";
    const labelPath = path.join(outputDir, `smoke_labels_${labelDateTag}.json`);
    const report = {
        generatedAt: new Date().toISOString(),
        projects: [
            {
                id: "demo",
                priority: "main",
                entries: [
                    {
                        sourceDir: "entry/src/main/ets",
                        entryName: "@arkMain",
                        entryPathHint: "entry/src/main/ets",
                        signature: "@arkMain",
                        score: 100,
                        status: "ok",
                        seedLocalNames: ["want"],
                        seedStrategies: ["contract_source"],
                        seedCount: 1,
                        flowCount: 0,
                        flowRuleTraces: [
                            {
                                source: "source_rule:demo",
                                sink: "Sink(arg0)",
                                sinkRuleId: "sink.demo.target",
                                sinkEndpoint: "arg0",
                                transferRuleIds: [],
                            },
                        ],
                        sinkRuleHits: {
                            "sink.demo.target": 1,
                        },
                        sinkFamilyHits: {
                            "sink.demo.family": 1,
                        },
                        sinkEndpointHits: {
                            arg0: 1,
                        },
                        sinkFlowByKeyword: {},
                        sinkFlowBySignature: {},
                        sinkSamples: ["Sink(arg0)"],
                        elapsedMs: 1,
                    },
                ],
            },
        ],
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    const scriptPath = path.resolve(__dirname, "test_smoke_labeling.js");
    const result = spawnSync(process.execPath, [
        scriptPath,
        "--report",
        reportPath,
        "--outputDir",
        outputDir,
        "--sampleSize",
        "4",
        "--dateTag",
        labelDateTag,
    ], {
        encoding: "utf8",
    });

    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }

    assert(result.status === 0, `test_smoke_labeling exited with status=${result.status}`);
    assert(fs.existsSync(labelPath), `label file not generated: ${labelPath}`);

    const labelFile = JSON.parse(fs.readFileSync(labelPath, "utf8")) as SmokeLabelFile;
    assert(labelFile.sampleSizeActual === 1, `expected sampleSizeActual=1, got ${labelFile.sampleSizeActual}`);
    assert(labelFile.items.length === 1, `expected 1 label item, got ${labelFile.items.length}`);
    assert(labelFile.items[0].candidateType === "flow_detected", `expected candidateType=flow_detected, got ${labelFile.items[0].candidateType}`);
    assert(labelFile.items[0].flowCount === 1, `expected flowCount=1 from sink inventory, got ${labelFile.items[0].flowCount}`);
    assert(labelFile.items[0].sinkRuleHits["sink.demo.target"] === 1, "expected sink.demo.target hit in label item");

    console.log("====== Smoke Sink Inventory Alignment ======");
    console.log(`sample_size_actual=${labelFile.sampleSizeActual}`);
    console.log(`candidate_type=${labelFile.items[0].candidateType}`);
    console.log(`inventory_flow_count=${labelFile.items[0].flowCount}`);
    console.log("PASS test_smoke_sink_inventory_alignment");
}

main();
