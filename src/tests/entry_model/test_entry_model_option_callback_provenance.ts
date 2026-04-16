import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { resolveKnownControllerOptionCallbackRegistrationsFromStmt } from "../../core/entry/shared/FrameworkCallbackClassifier";
import { buildTestScene } from "../helpers/TestSceneBuilder";

interface ProbeSummary {
    generatedAt: string;
    sourceDir: string;
    positiveCount: number;
    wrongShapeCount: number;
    sameFileCount: number;
    positiveReasons: string[];
    positiveRegistrations: Array<{
        registrationMethodName: string;
        registrationOwnerName: string;
        callbackArgIndex: number;
        slotFamily?: string;
        recognitionLayer?: string;
        registrationShape?: string;
        reason: string;
    }>;
}

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function findMethod(scene: Scene, methodName: string): any {
    const methods = scene.getMethods().filter(method => method.getName?.() === methodName);
    assert(methods.length === 1, `expected exactly one method named ${methodName}, actual=${methods.length}`);
    return methods[0];
}

function collectOptionRegistrations(scene: Scene, methodName: string): any[] {
    const sourceMethod = findMethod(scene, methodName);
    const cfg = sourceMethod.getCfg?.();
    assert(cfg, `missing cfg for ${methodName}`);

    const out: any[] = [];
    for (const stmt of cfg.getStmts()) {
        out.push(...resolveKnownControllerOptionCallbackRegistrationsFromStmt(stmt, scene, sourceMethod));
    }
    return out;
}

function main(): void {
    const sourceDir = path.resolve("tests/demo/option_callback_provenance_probe");
    const outputDir = path.resolve("tmp/test_runs/entry_model/option_callback_provenance/latest");
    fs.mkdirSync(outputDir, { recursive: true });

    const scene = buildTestScene(sourceDir);
    const positive = collectOptionRegistrations(scene, "imported_module_animate_to_positive_T");
    const wrongShape = collectOptionRegistrations(scene, "imported_wrong_shape_negative_F");
    const sameFile = collectOptionRegistrations(scene, "local_same_file_animate_to_negative_F");

    assert(positive.length === 1, `expected one module-backed animateTo options registration, actual=${positive.length}`);
    assert(wrongShape.length === 0, `wrong-shape imported animateTo should not be recognized, actual=${wrongShape.length}`);
    assert(sameFile.length === 0, `same-file animateTo should not be recognized as module semantic callback registration, actual=${sameFile.length}`);

    const [positiveRegistration] = positive;
    assert(
        positiveRegistration.registrationMethodName === "animateTo",
        `positive registration method mismatch: ${positiveRegistration.registrationMethodName}`,
    );
    assert(
        positiveRegistration.registrationShape === "options_object_slot",
        `positive registration shape mismatch: ${positiveRegistration.registrationShape}`,
    );
    assert(
        positiveRegistration.slotFamily === "controller_option_slot",
        `positive slot family mismatch: ${positiveRegistration.slotFamily}`,
    );
    assert(
        positiveRegistration.recognitionLayer === "controller_options",
        `positive recognition layer mismatch: ${positiveRegistration.recognitionLayer}`,
    );
    assert(
        String(positiveRegistration.reason || "").includes("Framework module callback registration"),
        `positive reason should reflect module semantic registration: ${positiveRegistration.reason}`,
    );

    const summary: ProbeSummary = {
        generatedAt: new Date().toISOString(),
        sourceDir,
        positiveCount: positive.length,
        wrongShapeCount: wrongShape.length,
        sameFileCount: sameFile.length,
        positiveReasons: positive.map(registration => registration.reason || ""),
        positiveRegistrations: positive.map(registration => ({
            registrationMethodName: registration.registrationMethodName,
            registrationOwnerName: registration.registrationOwnerName,
            callbackArgIndex: registration.callbackArgIndex,
            slotFamily: registration.slotFamily,
            recognitionLayer: registration.recognitionLayer,
            registrationShape: registration.registrationShape,
            reason: registration.reason,
        })),
    };

    const reportPath = path.join(outputDir, "option_callback_provenance_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), "utf8");

    console.log(`report=${reportPath}`);
    console.log("PASS test_entry_model_option_callback_provenance");
}

main();
