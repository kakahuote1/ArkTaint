import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { RuleInvokeKind, RuleMatchKind, RuleScopeConstraint, RuleStringConstraint } from "../core/rules/RuleSchema";

type RuleKind = "source" | "sink" | "transfer";

interface FrameworkRuleLike {
    id: string;
    enabled?: boolean;
    family?: string;
    tier?: "A" | "B" | "C";
    kind?: string;
    profile?: string;
    tags?: string[];
    match: {
        kind: RuleMatchKind;
        value: string;
    };
    scope?: RuleScopeConstraint;
    invokeKind?: RuleInvokeKind;
    argCount?: number;
    typeHint?: string;
}

interface SignatureSample {
    sourceDir?: string;
    callerSignature?: string;
    callerMethod?: string;
    callerFile?: string;
}

interface SignatureSite {
    signature: string;
    methodName: string;
    classSignature: string;
    className: string;
    invokeKind: RuleInvokeKind;
    argCount: number;
    samples?: SignatureSample[];
}

interface MethodSite {
    signature: string;
    methodName: string;
    classSignature: string;
    className: string;
    filePath: string;
}

interface RuleCoverageItem {
    kind: RuleKind;
    id: string;
    family: string;
    tier: string;
    runtimeHit: number;
    staticHit: boolean;
    boundaryDeclared: boolean;
    satisfied: boolean;
}

interface FamilyCoverageSummary {
    family: string;
    kind: RuleKind;
    ruleCount: number;
    runtimeHitTotal: number;
    staticHit: boolean;
    boundaryDeclared: boolean;
    satisfied: boolean;
}

function runNode(args: string[]): void {
    const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: process.cwd() });
    if (result.status !== 0) {
        throw new Error(`Command failed: node ${args.join(" ")}`);
    }
}

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : signature;
}

function matchesStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
    if (!constraint) return true;
    if (constraint.mode === "equals") return text === constraint.value;
    if (constraint.mode === "contains") return text.includes(constraint.value);
    try {
        return new RegExp(constraint.value).test(text);
    } catch {
        return false;
    }
}

function matchesInvokeShape(rule: FrameworkRuleLike, site: SignatureSite): boolean {
    if (rule.invokeKind && rule.invokeKind !== "any" && rule.invokeKind !== site.invokeKind) return false;
    if (typeof rule.argCount === "number" && rule.argCount !== site.argCount) return false;
    if (rule.typeHint && rule.typeHint.trim().length > 0) {
        const hint = rule.typeHint.trim().toLowerCase();
        const haystack = `${site.signature} ${site.classSignature} ${site.className}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }
    return true;
}

function matchesRuleMatchOnSignature(rule: FrameworkRuleLike, site: SignatureSite): boolean {
    const value = rule.match?.value || "";
    switch (rule.match?.kind) {
        case "method_name_equals":
            return site.methodName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(site.methodName);
            } catch {
                return false;
            }
        case "signature_contains":
            return site.signature.includes(value);
        case "signature_equals":
        case "callee_signature_equals":
            return site.signature === value;
        case "signature_regex":
            try {
                return new RegExp(value).test(site.signature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return site.classSignature === value || site.className === value;
        default:
            return false;
    }
}

function matchesRuleMatchOnMethod(rule: FrameworkRuleLike, method: MethodSite): boolean {
    const value = rule.match?.value || "";
    switch (rule.match?.kind) {
        case "method_name_equals":
            return method.methodName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(method.methodName);
            } catch {
                return false;
            }
        case "signature_contains":
            return method.signature.includes(value);
        case "signature_equals":
        case "callee_signature_equals":
            return method.signature === value;
        case "signature_regex":
            try {
                return new RegExp(value).test(method.signature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return method.classSignature === value || method.className === value;
        default:
            return false;
    }
}

function matchesCalleeScopeForSignature(scope: RuleScopeConstraint | undefined, site: SignatureSite): boolean {
    if (!scope) return true;
    const calleeFile = extractFilePathFromSignature(site.signature);
    const classText = `${site.classSignature} ${site.className}`;
    if (!matchesStringConstraint(scope.file, calleeFile)) return false;
    if (!matchesStringConstraint(scope.module, site.signature)) return false;
    if (!matchesStringConstraint(scope.className, classText)) return false;
    if (!matchesStringConstraint(scope.methodName, site.methodName)) return false;
    return true;
}

function matchesCalleeScopeForMethod(scope: RuleScopeConstraint | undefined, method: MethodSite): boolean {
    if (!scope) return true;
    const classText = `${method.classSignature} ${method.className}`;
    if (!matchesStringConstraint(scope.file, method.filePath)) return false;
    if (!matchesStringConstraint(scope.module, method.signature)) return false;
    if (!matchesStringConstraint(scope.className, classText)) return false;
    if (!matchesStringConstraint(scope.methodName, method.methodName)) return false;
    return true;
}

function matchesCallerScope(scope: RuleScopeConstraint | undefined, site: SignatureSite): boolean {
    if (!scope) return true;
    const samples = site.samples || [];
    if (samples.length === 0) return false;
    return samples.some(sample => {
        const callerSig = sample.callerSignature || "";
        const callerFile = (sample.callerFile || extractFilePathFromSignature(callerSig)).replace(/\\/g, "/");
        const callerMethod = sample.callerMethod || "";
        return matchesStringConstraint(scope.file, callerFile)
            && matchesStringConstraint(scope.module, callerSig || callerFile)
            && matchesStringConstraint(scope.className, callerSig)
            && matchesStringConstraint(scope.methodName, callerMethod);
    });
}

function sourceRuleKind(rule: FrameworkRuleLike): string {
    return rule.kind || (rule.profile === "entry_param" ? "entry_param" : "seed_local_name");
}

function staticRuleMatches(kind: RuleKind, rule: FrameworkRuleLike, signatures: SignatureSite[], methods: MethodSite[]): boolean {
    if (kind === "source") {
        const srcKind = sourceRuleKind(rule);
        if (srcKind === "entry_param") {
            return methods.some(method => {
                if (!matchesRuleMatchOnMethod(rule, method)) return false;
                return matchesCalleeScopeForMethod(rule.scope, method);
            });
        }

        if (srcKind === "call_return" || srcKind === "call_arg" || srcKind === "callback_param") {
            return signatures.some(site => {
                if (!matchesInvokeShape(rule, site)) return false;
                if (!matchesRuleMatchOnSignature(rule, site)) return false;
                return matchesCallerScope(rule.scope, site) || matchesCalleeScopeForSignature(rule.scope, site);
            });
        }

        return false;
    }

    return signatures.some(site => {
        if (!matchesInvokeShape(rule, site)) return false;
        if (!matchesRuleMatchOnSignature(rule, site)) return false;
        return matchesCalleeScopeForSignature(rule.scope, site);
    });
}

function main(): void {
    const probeRepo = path.resolve("tests/demo/sdk_signature_probe");
    const signaturesPath = path.resolve("tmp/sdk_signature_probe/signatures.json");
    const analyzeOutputDir = path.resolve("tmp/sdk_signature_probe/analyze");
    const summaryPath = path.join(analyzeOutputDir, "summary.json");
    const frameworkRulePath = path.resolve("rules/framework.rules.json");
    const coverageJsonPath = path.resolve("tmp/sdk_signature_probe/coverage_report.json");
    const coverageMdPath = path.resolve("tmp/sdk_signature_probe/coverage_report.md");

    runNode([
        "out/cli/dump_invoke_signatures.js",
        "--repo", probeRepo,
        "--sourceDir", ".",
        "--output", signaturesPath,
    ]);
    runNode([
        "out/cli/analyze.js",
        "--repo", probeRepo,
        "--sourceDir", ".",
        "--profile", "default",
        "--maxEntries", "200",
        "--outputDir", analyzeOutputDir,
        "--reportMode", "full",
    ]);

    const signatureDump = readJson<{ signatures: SignatureSite[]; methods?: MethodSite[] }>(signaturesPath);
    const summary = readJson<any>(summaryPath);
    const frameworkRules = readJson<{
        sources?: FrameworkRuleLike[];
        sinks?: FrameworkRuleLike[];
        transfers?: FrameworkRuleLike[];
    }>(frameworkRulePath);

    const runtimeHits = {
        source: (summary?.summary?.ruleHits?.source || {}) as Record<string, number>,
        sink: (summary?.summary?.ruleHits?.sink || {}) as Record<string, number>,
        transfer: (summary?.summary?.ruleHits?.transfer || {}) as Record<string, number>,
    };

    const allRules: Array<{ kind: RuleKind; rule: FrameworkRuleLike }> = [];
    for (const rule of frameworkRules.sources || []) if (rule.enabled !== false) allRules.push({ kind: "source", rule });
    for (const rule of frameworkRules.sinks || []) if (rule.enabled !== false) allRules.push({ kind: "sink", rule });
    for (const rule of frameworkRules.transfers || []) if (rule.enabled !== false) allRules.push({ kind: "transfer", rule });

    const methods = signatureDump.methods || [];
    const ruleCoverage: RuleCoverageItem[] = allRules.map(({ kind, rule }) => {
        const staticHit = staticRuleMatches(kind, rule, signatureDump.signatures || [], methods);
        const runtimeHit = (runtimeHits as any)[kind][rule.id] || 0;
        const boundaryDeclared = (rule.tags || []).includes("probe_boundary") || (rule.tags || []).includes("boundary");
        const satisfied = runtimeHit > 0 || staticHit || boundaryDeclared;
        return {
            kind,
            id: rule.id,
            family: rule.family || rule.id,
            tier: rule.tier || "-",
            runtimeHit,
            staticHit,
            boundaryDeclared,
            satisfied,
        };
    });

    const unresolvedRules = ruleCoverage.filter(x => !x.satisfied)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const zeroHitRules = ruleCoverage.filter(x => x.runtimeHit <= 0)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

    const familyMap = new Map<string, FamilyCoverageSummary>();
    for (const item of ruleCoverage) {
        const familyKey = `${item.kind}::${item.family}`;
        const prev = familyMap.get(familyKey) || {
            family: item.family,
            kind: item.kind,
            ruleCount: 0,
            runtimeHitTotal: 0,
            staticHit: false,
            boundaryDeclared: false,
            satisfied: false,
        };
        prev.ruleCount += 1;
        prev.runtimeHitTotal += item.runtimeHit;
        prev.staticHit = prev.staticHit || item.staticHit;
        prev.boundaryDeclared = prev.boundaryDeclared || item.boundaryDeclared;
        prev.satisfied = prev.runtimeHitTotal > 0 || prev.staticHit || prev.boundaryDeclared;
        familyMap.set(familyKey, prev);
    }

    const familySummaries = [...familyMap.values()]
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.family.localeCompare(b.family));

    const coveragePercent = ruleCoverage.length > 0
        ? (ruleCoverage.length - unresolvedRules.length) * 100 / ruleCoverage.length
        : 100;

    fs.mkdirSync(path.dirname(coverageJsonPath), { recursive: true });
    fs.writeFileSync(coverageJsonPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        probeRepo,
        signaturesPath,
        summaryPath,
        frameworkRulePath,
        enabledRules: ruleCoverage.length,
        unresolvedRuleCount: unresolvedRules.length,
        ruleCoveragePercent: Number(coveragePercent.toFixed(2)),
        ruleCoverage,
        unresolvedRules,
        zeroHitRules,
        familySummaries,
    }, null, 2), "utf-8");

    const md: string[] = [];
    md.push("# Framework Probe Coverage Report");
    md.push("");
    md.push(`- generatedAt: ${new Date().toISOString()}`);
    md.push(`- enabledRules: ${ruleCoverage.length}`);
    md.push(`- unresolvedRules: ${unresolvedRules.length}`);
    md.push(`- coveragePercent: ${coveragePercent.toFixed(2)}%`);
    md.push(`- zeroHitRules(runtime): ${zeroHitRules.length}`);
    md.push(`- signaturesPath: ${signaturesPath}`);
    md.push(`- summaryPath: ${summaryPath}`);
    md.push("");

    md.push("## Rule Coverage");
    md.push("");
    md.push("| Kind | Rule | Tier | RuntimeHit | StaticHit | Boundary | Satisfied |");
    md.push("|---|---|---|---:|---|---|---|");
    for (const x of ruleCoverage.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))) {
        md.push(`| ${x.kind} | ${x.id} | ${x.tier} | ${x.runtimeHit} | ${x.staticHit ? "Y" : "N"} | ${x.boundaryDeclared ? "Y" : "N"} | ${x.satisfied ? "Y" : "N"} |`);
    }

    md.push("");
    md.push("## Family Coverage");
    md.push("");
    md.push("| Kind | Family | RuleCount | RuntimeHit | StaticHit | Boundary | Satisfied |");
    md.push("|---|---|---:|---:|---|---|---|");
    for (const x of familySummaries) {
        md.push(`| ${x.kind} | ${x.family} | ${x.ruleCount} | ${x.runtimeHitTotal} | ${x.staticHit ? "Y" : "N"} | ${x.boundaryDeclared ? "Y" : "N"} | ${x.satisfied ? "Y" : "N"} |`);
    }

    if (unresolvedRules.length > 0) {
        md.push("");
        md.push("## Unresolved Rules");
        md.push("");
        for (const x of unresolvedRules) {
            md.push(`- [${x.kind}] ${x.id} (tier=${x.tier}, runtimeHit=${x.runtimeHit}, staticHit=${x.staticHit}, boundary=${x.boundaryDeclared})`);
        }
    }

    md.push("");
    md.push("## Zero-hit Rules (Runtime)");
    md.push("");
    for (const x of zeroHitRules) {
        md.push(`- [${x.kind}] ${x.id} (tier=${x.tier}, staticHit=${x.staticHit}, boundary=${x.boundaryDeclared})`);
    }

    fs.writeFileSync(coverageMdPath, `${md.join("\n")}\n`, "utf-8");

    console.log("====== Framework Probe Coverage ======");
    console.log(`enabled_rules=${ruleCoverage.length}`);
    console.log(`unresolved_rules=${unresolvedRules.length}`);
    console.log(`coverage_percent=${coveragePercent.toFixed(2)}%`);
    console.log(`zero_hit_rules_runtime=${zeroHitRules.length}`);
    console.log(`report_json=${coverageJsonPath}`);
    console.log(`report_md=${coverageMdPath}`);

    if (unresolvedRules.length > 0) {
        process.exit(2);
    }
}

main();
