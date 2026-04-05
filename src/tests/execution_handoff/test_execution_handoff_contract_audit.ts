import * as fs from "fs";
import * as path from "path";
import { buildTestScene } from "../helpers/TestSceneBuilder";

type SceneLike = any;
type MethodLike = any;

interface FutureUnitRecord {
    signature: string;
    filePath: string;
    payloadCount: number;
    captureCount: number;
    shape: "payload_only" | "capture_only" | "mixed" | "empty";
}

interface TriggerAudit {
    onClick: number;
    then: number;
    catch: number;
    finally: number;
    await: number;
    ptrinvoke: number;
    returnCallable: number;
}

interface AuditReport {
    generatedAt: string;
    directories: string[];
    futureUnitCount: number;
    shapes: Record<FutureUnitRecord["shape"], number>;
    triggers: TriggerAudit;
    futureUnits: FutureUnitRecord[];
}

const TARGET_DIRS = [
    "tests/demo/harmony_callback_registration",
    "tests/adhoc/ordinary_callable_language",
    "tests/adhoc/ordinary_async_language",
];

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function getScene(relativeDir: string): SceneLike {
    return buildTestScene(path.resolve(relativeDir));
}

function stmtTexts(method: MethodLike): string[] {
    const cfg = method.getCfg?.();
    if (!cfg) {
        return [];
    }
    return cfg.getStmts().map((stmt: any) => stmt.toString());
}

function meaningfulMethod(method: MethodLike): boolean {
    const texts = stmtTexts(method);
    return texts.length > 0;
}

function paramBindingCounts(method: MethodLike): { payloadCount: number; captureCount: number } {
    const regex = /^\s*([^=\s]+)\s*=\s*parameter(\d+):/;
    let payloadCount = 0;
    let captureCount = 0;
    for (const text of stmtTexts(method)) {
        const match = text.match(regex);
        if (!match) {
            continue;
        }
        if (match[1].startsWith("%closures")) {
            captureCount += 1;
        } else {
            payloadCount += 1;
        }
    }
    return { payloadCount, captureCount };
}

function classifyShape(payloadCount: number, captureCount: number): FutureUnitRecord["shape"] {
    if (payloadCount > 0 && captureCount > 0) {
        return "mixed";
    }
    if (payloadCount > 0) {
        return "payload_only";
    }
    if (captureCount > 0) {
        return "capture_only";
    }
    return "empty";
}

function collectFutureUnits(scene: SceneLike): FutureUnitRecord[] {
    const records: FutureUnitRecord[] = [];
    for (const method of scene.getMethods()) {
        const signature = method.getSignature?.().toString?.() || "";
        if (!signature.includes("%AM") || !signature.includes("$")) {
            continue;
        }
        if (signature.includes("taint_mock.ts")) {
            continue;
        }
        if (!meaningfulMethod(method)) {
            continue;
        }
        const { payloadCount, captureCount } = paramBindingCounts(method);
        records.push({
            signature,
            filePath: signature.split(":")[0] || signature,
            payloadCount,
            captureCount,
            shape: classifyShape(payloadCount, captureCount),
        });
    }
    return records;
}

function collectTriggerAudit(scene: SceneLike): TriggerAudit {
    const audit: TriggerAudit = {
        onClick: 0,
        then: 0,
        catch: 0,
        finally: 0,
        await: 0,
        ptrinvoke: 0,
        returnCallable: 0,
    };

    for (const method of scene.getMethods()) {
        for (const text of stmtTexts(method)) {
            if (text.includes(".onClick(")) {
                audit.onClick += 1;
            }
            if (text.includes(".then()")) {
                audit.then += 1;
            }
            if (text.includes(".catch()")) {
                audit.catch += 1;
            }
            if (text.includes(".finally()")) {
                audit.finally += 1;
            }
            if (text.includes("await ")) {
                audit.await += 1;
            }
            if (text.includes("ptrinvoke ")) {
                audit.ptrinvoke += 1;
            }
            if (text.includes("return %AM")) {
                audit.returnCallable += 1;
            }
        }
    }

    return audit;
}

function addAudit(into: TriggerAudit, other: TriggerAudit): void {
    into.onClick += other.onClick;
    into.then += other.then;
    into.catch += other.catch;
    into.finally += other.finally;
    into.await += other.await;
    into.ptrinvoke += other.ptrinvoke;
    into.returnCallable += other.returnCallable;
}

function main(): void {
    const allFutureUnits: FutureUnitRecord[] = [];
    const triggerTotals: TriggerAudit = {
        onClick: 0,
        then: 0,
        catch: 0,
        finally: 0,
        await: 0,
        ptrinvoke: 0,
        returnCallable: 0,
    };

    for (const dir of TARGET_DIRS) {
        const scene = getScene(dir);
        allFutureUnits.push(...collectFutureUnits(scene));
        addAudit(triggerTotals, collectTriggerAudit(scene));
    }

    const shapes: Record<FutureUnitRecord["shape"], number> = {
        payload_only: 0,
        capture_only: 0,
        mixed: 0,
        empty: 0,
    };
    for (const unit of allFutureUnits) {
        shapes[unit.shape] += 1;
    }

    const report: AuditReport = {
        generatedAt: new Date().toISOString(),
        directories: TARGET_DIRS,
        futureUnitCount: allFutureUnits.length,
        shapes,
        triggers: triggerTotals,
        futureUnits: allFutureUnits,
    };

    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_contract/latest");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_contract_audit.json"),
        JSON.stringify(report, null, 2),
        "utf8",
    );

    assert(allFutureUnits.length >= 10, `expected enough future method units, got ${allFutureUnits.length}`);
    assert(shapes.payload_only > 0, "expected payload-only future units");
    assert(shapes.capture_only > 0, "expected capture-only future units");
    assert(shapes.empty > 0, "expected empty-ingress future units such as finally callbacks");
    assert(triggerTotals.onClick > 0, "expected event-registration triggers");
    assert(triggerTotals.then > 0, "expected then triggers");
    assert(triggerTotals.catch > 0, "expected catch triggers");
    assert(triggerTotals.finally > 0, "expected finally triggers");
    assert(triggerTotals.await > 0, "expected await resume sites");
    assert(triggerTotals.ptrinvoke > 0, "expected ptrinvoke-based direct callable triggers");
    assert(triggerTotals.returnCallable > 0, "expected helper/factory return-callable relays");

    console.log("execution_handoff_contract_audit=PASS");
    console.log(`future_units=${allFutureUnits.length}`);
    console.log(`shapes payload_only=${shapes.payload_only} capture_only=${shapes.capture_only} mixed=${shapes.mixed} empty=${shapes.empty}`);
    console.log(
        `triggers onClick=${triggerTotals.onClick} then=${triggerTotals.then} catch=${triggerTotals.catch} finally=${triggerTotals.finally} await=${triggerTotals.await} ptrinvoke=${triggerTotals.ptrinvoke} returnCallable=${triggerTotals.returnCallable}`,
    );
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_contract_audit=FAIL");
    console.error(err);
    process.exitCode = 1;
}

