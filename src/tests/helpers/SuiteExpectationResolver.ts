import * as fs from "fs";
import * as path from "path";

interface BenchmarkExpectationManifest {
    cases?: Record<string, boolean>;
}

let cachedExpectations: Record<string, boolean> | undefined;

function getExpectationMap(): Record<string, boolean> {
    if (cachedExpectations !== undefined) {
        return cachedExpectations;
    }
    const manifestPath = path.resolve("tests/manifests/benchmarks/harmony_modeling_expectations.json");
    if (!fs.existsSync(manifestPath)) {
        cachedExpectations = {};
        return cachedExpectations;
    }
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BenchmarkExpectationManifest;
    cachedExpectations = parsed.cases || {};
    return cachedExpectations;
}

export function resolveSuiteCaseExpectation(suiteId: string, caseName: string): boolean {
    const expectations = getExpectationMap();
    const key = `${suiteId}/${caseName}`;
    if (Object.prototype.hasOwnProperty.call(expectations, key)) {
        return !!expectations[key];
    }
    return caseName.endsWith("_T");
}
