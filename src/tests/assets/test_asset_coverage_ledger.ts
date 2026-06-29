import {
    createCoverageLedger,
    type CoverageLedgerEntry,
    type ObservedSurface,
    validateCoverageLedger,
} from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const observed: ObservedSurface[] = [
    {
        observedSurfaceId: "obs.console.log",
        rawKind: "call",
        location: { file: "Index.ets", line: 1 },
        analyzerEvidence: {
            canonicalApiId: "api:official:openharmony:%40ohos.console:api%2F%40ohos.console.d.ts:export=namespace%3Aconsole:owner=namespace%3Aconsole:member=method%3Alog:invoke=call:params=0%3AObject:return=void",
            arkanalyzer: {
                methodKey: {
                    declaringFileName: "api/@ohos.console.d.ts",
                    declaringNamespacePath: [],
                    declaringClassName: "console",
                    methodName: "log",
                    parameterTypes: ["Object"],
                    returnType: "void",
                    staticFlag: true,
                },
            },
        },
        resolutionStatus: "resolved",
    },
    {
        observedSurfaceId: "obs.project.logger",
        rawKind: "call",
        location: { file: "Logger.ets", line: 7 },
        analyzerEvidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: "project/Logger.ets",
                    declaringNamespacePath: [],
                    declaringClassName: "Logger",
                    methodName: "info",
                    parameterTypes: ["Object"],
                    returnType: "void",
                    staticFlag: true,
                },
            },
        },
        resolutionStatus: "resolved",
    },
    {
        observedSurfaceId: "obs.unknown",
        rawKind: "call",
        location: { file: "Unknown.ets", line: 3 },
        analyzerEvidence: {},
        resolutionStatus: "unresolved",
        unresolvedReason: "callee signature is not available",
    },
    {
        observedSurfaceId: "obs.language.local",
        rawKind: "access",
        location: { file: "Index.ets", line: 10 },
        analyzerEvidence: {
            canonicalApiId: "api:project:local:local:Index.ets:export=namespace%3Alocal:owner=namespace%3Alocal:member=property%3Avalue:invoke=property-read:params=:return=Object",
        },
        resolutionStatus: "ignored",
        ignoredReason: "ordinary local access with no asset surface",
    },
];

function validEntries(): CoverageLedgerEntry[] {
    return [
        {
            observedSurfaceId: "obs.console.log",
            coverageStatus: "covered-exact-role",
            role: "sink",
            matchedAssetIds: ["asset.rule.console.log"],
            matchedBindingIds: ["binding.console.log.arg0.sink"],
            decision: "skip-llm",
            reason: "official console.log sink binding covers arg0",
        },
        {
            observedSurfaceId: "obs.project.logger",
            coverageStatus: "not-covered",
            decision: "send-to-llm",
            reason: "project logger surface has no reviewed asset binding",
        },
        {
            observedSurfaceId: "obs.unknown",
            coverageStatus: "identity-unresolved",
            decision: "send-to-llm",
            reason: "callee signature is not available",
        },
        {
            observedSurfaceId: "obs.language.local",
            coverageStatus: "ignored-by-policy",
            decision: "ignore",
            reason: "ordinary local access with no asset surface",
        },
    ];
}

function main(): void {
    const ledger = createCoverageLedger("project-a", "run-1", observed, validEntries());
    assert(ledger.summary.totalObservedSurfaces === 4, "expected four observed surfaces");
    assert(ledger.summary.exactCovered === 1, "expected one exact covered surface");
    assert(ledger.summary.notCovered === 1, "expected one not-covered surface");
    assert(ledger.summary.identityUnresolved === 1, "expected one unresolved surface");
    assert(ledger.summary.ignoredByPolicy === 1, "expected one ignored surface");
    assert(ledger.summary.sentToLLM === 2, "expected two sent-to-LLM entries");

    const validResult = validateCoverageLedger(ledger, observed);
    assert(validResult.valid, `valid coverage ledger should pass: ${validResult.errors.join("; ")}`);

    const missing = createCoverageLedger("project-a", "run-2", observed, validEntries().slice(1));
    const missingResult = validateCoverageLedger(missing, observed);
    assert(!missingResult.valid, "ledger missing an observed surface should fail");
    assert(
        missingResult.errors.some(error => error.includes("has no coverage ledger entry")),
        `missing ledger should explain absent entry, got: ${missingResult.errors.join("; ")}`
    );

    const duplicateEntries = validEntries();
    duplicateEntries.push({ ...duplicateEntries[0] });
    const duplicate = createCoverageLedger("project-a", "run-3", observed, duplicateEntries);
    const duplicateResult = validateCoverageLedger(duplicate, observed);
    assert(!duplicateResult.valid, "duplicate ledger entry should fail");
    assert(
        duplicateResult.errors.some(error => error.includes("duplicate coverage ledger entry")),
        `duplicate ledger should explain duplicate entry, got: ${duplicateResult.errors.join("; ")}`
    );

    const unexplainedEntries = validEntries();
    unexplainedEntries[1] = { ...unexplainedEntries[1], reason: "" };
    const unexplained = createCoverageLedger("project-a", "run-4", observed, unexplainedEntries);
    const unexplainedResult = validateCoverageLedger(unexplained, observed);
    assert(!unexplainedResult.valid, "ledger entry without reason should fail");
    assert(
        unexplainedResult.errors.some(error => error.includes("must explain its terminal status")),
        `unexplained ledger should require a reason, got: ${unexplainedResult.errors.join("; ")}`
    );

    const coveredWithoutEvidenceEntries = validEntries();
    coveredWithoutEvidenceEntries[0] = {
        ...coveredWithoutEvidenceEntries[0],
        matchedAssetIds: [],
    };
    const coveredWithoutEvidence = createCoverageLedger("project-a", "run-5", observed, coveredWithoutEvidenceEntries);
    const coveredWithoutEvidenceResult = validateCoverageLedger(coveredWithoutEvidence, observed);
    assert(!coveredWithoutEvidenceResult.valid, "covered-exact ledger without asset evidence should fail");
    assert(
        coveredWithoutEvidenceResult.errors.some(error => error.includes("must reference matched asset and binding ids")),
        `covered-exact ledger should require asset and binding evidence, got: ${coveredWithoutEvidenceResult.errors.join("; ")}`
    );

    const illegalSkipEntries = validEntries();
    illegalSkipEntries[1] = { ...illegalSkipEntries[1], decision: "skip-llm" };
    const illegalSkip = createCoverageLedger("project-a", "run-6", observed, illegalSkipEntries);
    const illegalSkipResult = validateCoverageLedger(illegalSkip, observed);
    assert(!illegalSkipResult.valid, "not-covered ledger entry must not skip LLM");
    assert(
        illegalSkipResult.errors.some(error => error.includes("cannot skip LLM")),
        `illegal skip should be explained, got: ${illegalSkipResult.errors.join("; ")}`
    );

    console.log("PASS test_asset_coverage_ledger");
}

main();
