import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    resolveKnownFrameworkCallbackRegistrationWithPolicy,
    CallbackRegistrationRecognitionLayer,
} from "../../core/entry/shared/FrameworkCallbackClassifier";
import { resolveMethodsFromCallable } from "../../core/substrate/queries/CalleeResolver";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

const CALLBACK_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
};

const NO_STRUCTURAL_FALLBACK_POLICY = {
    enableSdkProvenance: true,
    enableOwnerQualifiedFallback: true,
    enableEmptyOwnerFallback: true,
    enableStructuralCallableFallback: false,
} as const;

const STRUCTURAL_FALLBACK_ONLY_POLICY = {
    enableSdkProvenance: false,
    enableOwnerQualifiedFallback: false,
    enableEmptyOwnerFallback: false,
    enableStructuralCallableFallback: true,
} as const;

interface ProbeRecord {
    sourceMethod: string;
    callSite: string;
    ownerName: string;
    methodName: string;
    callableArgIndexes: number[];
    withoutFallback: { recognized: boolean; layer?: CallbackRegistrationRecognitionLayer };
    withFallback: { recognized: boolean; layer?: CallbackRegistrationRecognitionLayer };
    structuralOnly: { recognized: boolean; layer?: CallbackRegistrationRecognitionLayer };
}

interface ProbeReport {
    generatedAt: string;
    totalCallSitesWithCallableArgs: number;
    recognizedWithoutFallback: number;
    recognizedWithFallback: number;
    newlyDiscoveredByFallback: number;
    structuralOnlyHits: number;
    records: ProbeRecord[];
    newDiscoveries: ProbeRecord[];
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

function findCallableArgIndexes(scene: Scene, explicitArgs: any[]): number[] {
    const indexes: number[] = [];
    explicitArgs.forEach((arg, index) => {
        const methods = resolveMethodsFromCallable(scene, arg, CALLBACK_RESOLVE_OPTIONS);
        if (methods.length > 0) {
            indexes.push(index);
        }
    });
    return indexes;
}

function runProbe(sourceDir: string): ProbeReport {
    const scene = buildScene(sourceDir);
    const records: ProbeRecord[] = [];

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const callableArgIndexes = findCallableArgIndexes(scene, explicitArgs);
            if (callableArgIndexes.length === 0) continue;

            const matcherArgs = { invokeExpr, explicitArgs, scene, sourceMethod: method };

            const withoutFallback = resolveKnownFrameworkCallbackRegistrationWithPolicy(
                matcherArgs,
                NO_STRUCTURAL_FALLBACK_POLICY,
            );
            const withFallback = resolveKnownFrameworkCallbackRegistrationWithPolicy(
                matcherArgs,
            );
            const structuralOnly = resolveKnownFrameworkCallbackRegistrationWithPolicy(
                matcherArgs,
                STRUCTURAL_FALLBACK_ONLY_POLICY,
            );

            const methodSig = invokeExpr.getMethodSignature?.();
            records.push({
                sourceMethod: method.getSignature?.()?.toString?.() || "",
                callSite: methodSig?.toString?.() || "",
                ownerName: methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
                methodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                callableArgIndexes,
                withoutFallback: {
                    recognized: !!withoutFallback,
                    layer: withoutFallback?.recognitionLayer,
                },
                withFallback: {
                    recognized: !!withFallback,
                    layer: withFallback?.recognitionLayer,
                },
                structuralOnly: {
                    recognized: !!structuralOnly,
                    layer: structuralOnly?.recognitionLayer,
                },
            });
        }
    }

    const newDiscoveries = records.filter(
        r => !r.withoutFallback.recognized && r.withFallback.recognized,
    );

    return {
        generatedAt: new Date().toISOString(),
        totalCallSitesWithCallableArgs: records.length,
        recognizedWithoutFallback: records.filter(r => r.withoutFallback.recognized).length,
        recognizedWithFallback: records.filter(r => r.withFallback.recognized).length,
        newlyDiscoveredByFallback: newDiscoveries.length,
        structuralOnlyHits: records.filter(r => r.structuralOnly.recognized).length,
        records,
        newDiscoveries,
    };
}

function main(): void {
    const outputDir = path.resolve("tmp/structural_fallback_probe");
    fs.mkdirSync(outputDir, { recursive: true });

    const sourceDir = path.resolve("tests/demo/harmony_callback_registration");
    console.log(`Running structural callable fallback probe on: ${sourceDir}`);

    const report = runProbe(sourceDir);

    const reportPath = path.join(outputDir, "structural_fallback_probe_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`\n=== Structural Callable Fallback Probe ===`);
    console.log(`Total call sites with callable args: ${report.totalCallSitesWithCallableArgs}`);
    console.log(`Recognized WITHOUT structural fallback: ${report.recognizedWithoutFallback}`);
    console.log(`Recognized WITH structural fallback:    ${report.recognizedWithFallback}`);
    console.log(`Newly discovered by fallback:           ${report.newlyDiscoveredByFallback}`);
    console.log(`Structural-only hits:                   ${report.structuralOnlyHits}`);

    if (report.newDiscoveries.length > 0) {
        console.log(`\nNew discoveries by structural fallback:`);
        for (const d of report.newDiscoveries) {
            console.log(`  ${d.ownerName}.${d.methodName} callable@[${d.callableArgIndexes}] éˆ?${d.withFallback.layer}`);
        }
    }

    if (report.totalCallSitesWithCallableArgs === 0) {
        throw new Error("Probe found no call sites with callable arguments.");
    }
    if (report.recognizedWithFallback < report.recognizedWithoutFallback) {
        throw new Error("Structural fallback caused regression éˆ?fewer recognitions than without it.");
    }
    if (report.newlyDiscoveredByFallback === 0) {
        throw new Error(
            "Structural fallback discovered nothing new. "
            + "Expected at least FakeButton.onClick to be caught.",
        );
    }

    console.log(`\nReport written to ${reportPath}`);
    console.log("PASS: Structural callable fallback is working.");
}

main();
