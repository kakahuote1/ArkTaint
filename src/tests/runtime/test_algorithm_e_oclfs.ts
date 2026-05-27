import * as assert from "assert";
import {
    OclfsSolver,
    OclfsSolverResult,
    StateCell,
    StateEffect,
    StateEffectBuilder,
    validateCurrentnessCertificate,
    validateStateEffect,
} from "../../core/kernel/oclfs";

function solve(builderEffects: StateEffect[], maxSliceEffects?: number): OclfsSolverResult {
    return new OclfsSolver(maxSliceEffects === undefined ? {} : { maxSliceEffects }).solve(builderEffects);
}

function verdicts(result: OclfsSolverResult): string[] {
    return result.certificates.map(cert => cert.verdict);
}

function reasons(result: OclfsSolverResult): string[] {
    return result.certificates.map(cert => cert.primaryReason);
}

function assertHasVerdict(result: OclfsSolverResult, verdict: string): void {
    assert.ok(
        verdicts(result).includes(verdict),
        `expected verdict ${verdict}, got ${verdicts(result).join(",")}`,
    );
}

function assertNoSink(result: OclfsSolverResult): void {
    assert.strictEqual(result.sinkHits.length, 0, `expected no sink hits, got ${JSON.stringify(result.sinkHits)}`);
}

function assertSink(result: OclfsSolverResult, label = "secret"): void {
    assert.ok(
        result.sinkHits.some(hit => hit.label === label),
        `expected sink hit for label ${label}, got ${JSON.stringify(result.sinkHits)}`,
    );
}

function testValidationContracts(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-validation-test" });
    const unknownSlot: StateCell = {
        ...builder.localSlot("x"),
        id: "local-slot|test|x|unknown",
        precision: "unknown",
    };
    const invalidKill = builder.kill(unknownSlot, "validation:kill", "strong");
    const invalidEffect = validateStateEffect(invalidKill);
    assert.strictEqual(invalidEffect.valid, false, "strong kill on unknown precision cell must be rejected");

    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const store = builder.store(xSlot, x1, "secret");
    const load = builder.load(xSlot, builder.value("x", "read"));
    const invalidCertificate = validateCurrentnessCertificate({
        id: "bad-cert",
        candidateFlow: {
            id: "flow",
            producerEffectId: store.id,
            consumerEffectId: load.id,
            producerCell: xSlot,
            consumerCell: xSlot,
            label: "secret",
        },
        verdict: "live",
        obligations: [],
        sliceCompleteness: "complete-for-cell",
        primaryReason: "missing_obligations",
        proofStatus: "complete-proof",
        confidence: "certain",
    });
    assert.strictEqual(invalidCertificate.valid, false, "certificate without obligations must be rejected");
}

function testLocalLiveFlow(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-local-live" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xRead = builder.value("x", "read");

    const result = solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.load(xSlot, xRead),
        builder.sink(xRead, "send"),
    ]);

    assertSink(result);
    assertHasVerdict(result, "live");
    assert.ok(result.certificates.every(cert => cert.obligations.length > 0), "certificates must carry obligations");
}

function testCleanOverwriteKillsCurrentSlot(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-clean-dead" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xRead = builder.value("x", "read");

    const result = solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.storeClean(xSlot),
        builder.load(xSlot, xRead),
        builder.sink(xRead, "send"),
    ]);

    assertNoSink(result);
    assertHasVerdict(result, "dead");
    assert.ok(reasons(result).includes("strong_clean_overwrite"), "dead reason should be clean overwrite");
}

function testValueVersionCopySurvivesLaterClean(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-value-version" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xUse = builder.value("x", "use");
    const ySlot = builder.localSlot("y");
    const yRead = builder.value("y", "read");

    const result = solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.load(xSlot, xUse),
        builder.store(ySlot, xUse),
        builder.storeClean(xSlot),
        builder.load(ySlot, yRead),
        builder.sink(yRead, "send"),
    ]);

    assertSink(result);
    assertHasVerdict(result, "live");
    assertHasVerdict(result, "blocked-mismatch");
}

function testWeakCleanRemainsMayLive(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-weak-clean" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xRead = builder.value("x", "read");

    const result = solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.storeClean(xSlot, "weak-clean", "weak"),
        builder.load(xSlot, xRead),
        builder.sink(xRead, "send"),
    ]);

    assertSink(result);
    assertHasVerdict(result, "may-live");
}

function testFieldCleanAndMismatch(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-field" });
    const sourceValue = builder.value("token", "1");
    const tokenField = builder.objectField("userObj", ["token"]);
    const nameField = builder.objectField("userObj", ["name"]);
    const fieldRead = builder.value("field", "read");

    const deadResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenField, sourceValue, "secret"),
        builder.storeClean(tokenField),
        builder.load(tokenField, fieldRead),
        builder.sink(fieldRead, "send"),
    ]);
    assertNoSink(deadResult);
    assertHasVerdict(deadResult, "dead");

    const mismatchRead = builder.value("name", "read");
    const mismatchResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenField, sourceValue, "secret"),
        builder.load(nameField, mismatchRead),
        builder.sink(mismatchRead, "send"),
    ]);
    assertNoSink(mismatchResult);
    assertHasVerdict(mismatchResult, "blocked-mismatch");
}

function testMapKeyMismatchAndUnknownKey(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-map" });
    const sourceValue = builder.value("token", "1");
    const tokenEntry = builder.mapEntry("cache", "token");
    const nameEntry = builder.mapEntry("cache", "name");
    const unknownEntry = builder.mapEntry("cache", "<dynamic>", "", "unknown");

    const mismatchRead = builder.value("map", "mismatch-read");
    const mismatchResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenEntry, sourceValue, "secret"),
        builder.load(nameEntry, mismatchRead),
        builder.sink(mismatchRead, "send"),
    ]);
    assertNoSink(mismatchResult);
    assertHasVerdict(mismatchResult, "blocked-mismatch");

    const unknownRead = builder.value("map", "unknown-read");
    const unknownResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenEntry, sourceValue, "secret"),
        builder.load(unknownEntry, unknownRead),
        builder.sink(unknownRead, "send"),
    ]);
    assertSink(unknownResult);
    assertHasVerdict(unknownResult, "may-live");
}

function testHandoffDeleteAndDynamicKey(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-handoff" });
    const sourceValue = builder.value("token", "1");
    const tokenCell = builder.keyedSemanticSlot("AppStorage", "token");
    const userCell = builder.keyedSemanticSlot("AppStorage", "user");
    const unknownCell = builder.keyedSemanticSlot("AppStorage", "<dynamic>", "", "unknown");

    const killedRead = builder.value("handoff", "killed-read");
    const killedResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenCell, sourceValue, "secret"),
        builder.kill(tokenCell),
        builder.load(tokenCell, killedRead),
        builder.sink(killedRead, "network"),
    ]);
    assertNoSink(killedResult);
    assertHasVerdict(killedResult, "dead");
    assert.ok(reasons(killedResult).includes("strong_kill"), "handoff delete should be strong kill");

    const mismatchRead = builder.value("handoff", "mismatch-read");
    const mismatchResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenCell, sourceValue, "secret"),
        builder.load(userCell, mismatchRead),
        builder.sink(mismatchRead, "network"),
    ]);
    assertNoSink(mismatchResult);
    assertHasVerdict(mismatchResult, "blocked-mismatch");

    const unknownRead = builder.value("handoff", "unknown-read");
    const unknownResult = solve([
        builder.source(sourceValue, "secret"),
        builder.store(tokenCell, sourceValue, "secret"),
        builder.load(unknownCell, unknownRead),
        builder.sink(unknownRead, "network"),
    ]);
    assertSink(unknownResult);
    assertHasVerdict(unknownResult, "may-live");
}

function testNamedSemanticSlotCells(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-semantic-cells" });
    const secretValue = builder.value("payload", "1");

    const profileRoute = builder.navigationParamSlot("router", "/pages/Profile:id");
    const settingsRoute = builder.navigationParamSlot("router", "/pages/Settings:id");
    const routeRead = builder.value("route", "read");
    const routeResult = solve([
        builder.source(secretValue, "secret"),
        builder.store(profileRoute, secretValue, "secret"),
        builder.load(settingsRoute, routeRead),
        builder.sink(routeRead, "route-sink"),
    ]);
    assertNoSink(routeResult);
    assertHasVerdict(routeResult, "blocked-mismatch");

    const loginEvent = builder.messageChannelSlot("EventBus", "login:arg0");
    const logoutEvent = builder.messageChannelSlot("EventBus", "logout:arg0");
    const eventRead = builder.value("event", "read");
    const eventResult = solve([
        builder.source(secretValue, "secret"),
        builder.store(loginEvent, secretValue, "secret"),
        builder.load(logoutEvent, eventRead),
        builder.sink(eventRead, "event-sink"),
    ]);
    assertNoSink(eventResult);
    assertHasVerdict(eventResult, "blocked-mismatch");

    const promiseResult = builder.asyncResultSlot("fetchUser", "fulfilled");
    const promiseRead = builder.value("promise", "read");
    const promiseDead = solve([
        builder.source(secretValue, "secret"),
        builder.store(promiseResult, secretValue, "secret"),
        builder.kill(promiseResult),
        builder.load(promiseResult, promiseRead),
        builder.sink(promiseRead, "promise-sink"),
    ]);
    assertNoSink(promiseDead);
    assertHasVerdict(promiseDead, "dead");

    const stateOwner = builder.reactiveStateSlot("Parent", "token");
    const stateConsumer = builder.reactiveStateSlot("Child", "token");
    const stateRead = builder.value("state", "read");
    const stateResult = solve([
        builder.source(secretValue, "secret"),
        builder.store(stateOwner, secretValue, "secret"),
        builder.link(stateOwner, stateConsumer),
        builder.load(stateConsumer, stateRead),
        builder.sink(stateRead, "state-sink"),
    ]);
    assertSink(stateResult);
    assertHasVerdict(stateResult, "live");
    assert.ok(
        stateResult.certificates.some(cert => cert.obligations.some(obligation => obligation.kind === "link-scope")),
        "reactive-state-slot link propagation must carry a link-scope obligation",
    );
}

function testTruncatedSliceCannotStronglyKill(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-truncated" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xRead = builder.value("x", "read");

    const result = solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.storeClean(xSlot),
        builder.load(xSlot, xRead),
        builder.sink(xRead, "send"),
    ], 0);

    assertSink(result);
    assertHasVerdict(result, "unknown");
    assert.ok(!verdicts(result).includes("dead"), "truncated slice must not produce dead");
}

function testUnknownModelConfidenceCannotStronglyKill(): void {
    const builder = new StateEffectBuilder({ origin: "oclfs-low-confidence", confidence: "unknown" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xRead = builder.value("x", "read");

    const result = solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.storeClean(xSlot, "low-confidence-clean", "strong"),
        builder.load(xSlot, xRead),
        builder.sink(xRead, "send"),
    ]);

    assertSink(result);
    assertHasVerdict(result, "unknown");
    assert.ok(!verdicts(result).includes("dead"), "unknown confidence must not produce strong dead");
}

async function main(): Promise<void> {
    const tests: Array<[string, () => void]> = [
        ["validation contracts", testValidationContracts],
        ["local live flow", testLocalLiveFlow],
        ["clean overwrite kills current slot", testCleanOverwriteKillsCurrentSlot],
        ["value version copy survives later clean", testValueVersionCopySurvivesLaterClean],
        ["weak clean remains may-live", testWeakCleanRemainsMayLive],
        ["field clean and mismatch", testFieldCleanAndMismatch],
        ["map key mismatch and unknown key", testMapKeyMismatchAndUnknownKey],
        ["handoff delete and dynamic key", testHandoffDeleteAndDynamicKey],
        ["named semantic slot cells", testNamedSemanticSlotCells],
        ["truncated slice cannot strongly kill", testTruncatedSliceCannotStronglyKill],
        ["unknown model confidence cannot strongly kill", testUnknownModelConfidenceCannotStronglyKill],
    ];

    for (const [name, test] of tests) {
        test();
        console.log(`PASS ${name}`);
    }
    console.log(`RESULT: ${tests.length} OCLFS tests passed`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
