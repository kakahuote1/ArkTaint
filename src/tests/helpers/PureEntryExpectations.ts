import * as fs from "fs";
import * as path from "path";

export interface PureEntryExpectationSuite {
    id: string;
    positiveCases: string[];
    negativeCases: string[];
}

interface PureEntryExpectationManifest {
    suites: PureEntryExpectationSuite[];
}

export function loadPureEntryExpectationSuites(): Map<string, PureEntryExpectationSuite> {
    const manifestPath = path.resolve("tests/manifests/entry_model/main_model_pure_entry_expectations.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PureEntryExpectationManifest;
    return new Map(manifest.suites.map(suite => [suite.id, suite]));
}

export function buildPureEntryExpectationLookup(
    suiteId: string,
    caseNames: string[],
    suites: Map<string, PureEntryExpectationSuite>,
): Map<string, boolean> {
    const suite = suites.get(suiteId);
    if (!suite) {
        throw new Error(`missing pure-entry expectation suite: ${suiteId}`);
    }

    const positives = new Set(suite.positiveCases);
    const negatives = new Set(suite.negativeCases);
    const lookup = new Map<string, boolean>();

    for (const caseName of caseNames) {
        const inPositive = positives.has(caseName);
        const inNegative = negatives.has(caseName);
        if (inPositive === inNegative) {
            throw new Error(`pure-entry expectation for ${suiteId}/${caseName} must appear in exactly one of positiveCases or negativeCases`);
        }
        lookup.set(caseName, inPositive);
    }

    const caseSet = new Set(caseNames);
    for (const caseName of [...positives, ...negatives]) {
        if (!caseSet.has(caseName)) {
            throw new Error(`pure-entry expectation references unknown case ${suiteId}/${caseName}`);
        }
    }

    return lookup;
}

