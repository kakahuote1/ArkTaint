import { Scene } from "../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../arkanalyzer/lib/Config";
import { ArkAssignStmt } from "../../arkanalyzer/lib/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/lib/core/base/Expr";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    repo: string;
    sourceDirs: string[];
    output: string;
    maxSamplesPerSignature: number;
}

interface InvokeSample {
    sourceDir: string;
    callerSignature: string;
    callerMethod: string;
    callerFile: string;
    line: number;
    invokeText: string;
}

interface SignatureAggregate {
    signature: string;
    methodName: string;
    classSignature: string;
    className: string;
    invokeKind: "instance" | "static" | "ptr";
    argCount: number;
    callbackArgIndexes: number[];
    callbackArgEvidence: "none" | "name" | "type" | "both";
    count: number;
    samples: InvokeSample[];
}

interface SignatureDumpReport {
    generatedAt: string;
    repo: string;
    sourceDirs: string[];
    totalMethods: number;
    totalInvokeSites: number;
    uniqueSignatures: number;
    methods: MethodAggregate[];
    signatures: SignatureAggregate[];
}

interface MethodAggregate {
    signature: string;
    methodName: string;
    classSignature: string;
    className: string;
    filePath: string;
}

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): CliOptions {
    let repo = "";
    let sourceDirs: string[] = [];
    let output = path.resolve("tmp", "sdk_signature_probe", "signatures.json");
    let maxSamplesPerSignature = 10;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : undefined;
        const readValue = (flag: string): string | undefined => {
            if (arg === flag) return next;
            if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
            return undefined;
        };

        const repoArg = readValue("--repo");
        if (repoArg !== undefined) {
            repo = repoArg;
            if (arg === "--repo") i++;
            continue;
        }

        const sourceDirArg = readValue("--sourceDir");
        if (sourceDirArg !== undefined) {
            sourceDirs.push(...splitCsv(sourceDirArg));
            if (arg === "--sourceDir") i++;
            continue;
        }

        const outputArg = readValue("--output");
        if (outputArg !== undefined) {
            output = path.resolve(outputArg);
            if (arg === "--output") i++;
            continue;
        }

        const maxSamplesArg = readValue("--maxSamplesPerSignature");
        if (maxSamplesArg !== undefined) {
            maxSamplesPerSignature = Number(maxSamplesArg);
            if (arg === "--maxSamplesPerSignature") i++;
            continue;
        }
    }

    if (!repo) {
        throw new Error("missing required --repo <path>");
    }
    const normalizedRepo = path.isAbsolute(repo) ? repo : path.resolve(repo);
    if (!fs.existsSync(normalizedRepo)) {
        throw new Error(`repo path not found: ${normalizedRepo}`);
    }

    if (sourceDirs.length === 0) {
        const auto = ["entry/src/main/ets", "src/main/ets", "."];
        sourceDirs = auto.filter(rel => fs.existsSync(path.resolve(normalizedRepo, rel)));
    }
    if (sourceDirs.length === 0) {
        throw new Error("no sourceDir found. pass --sourceDir");
    }

    if (!Number.isFinite(maxSamplesPerSignature) || maxSamplesPerSignature <= 0) {
        throw new Error(`invalid --maxSamplesPerSignature: ${maxSamplesPerSignature}`);
    }

    return {
        repo: normalizedRepo,
        sourceDirs: sourceDirs.map(d => d.replace(/\\/g, "/")),
        output,
        maxSamplesPerSignature: Math.floor(maxSamplesPerSignature),
    };
}

function extractArkFileFromSignature(signature: string): string {
    const m = signature.match(/@([^:]+):/);
    if (!m) return "";
    return m[1].replace(/\\/g, "/");
}

function resolveInvokeKind(expr: any): "instance" | "static" | "ptr" | undefined {
    if (expr instanceof ArkInstanceInvokeExpr) return "instance";
    if (expr instanceof ArkStaticInvokeExpr) return "static";
    if (expr instanceof ArkPtrInvokeExpr) return "ptr";
    return undefined;
}

function extractMethodName(signature: string): string {
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function inferCallbackArgMeta(args: any[]): {
    indexes: number[];
    evidence: "none" | "name" | "type" | "both";
} {
    const indexes: number[] = [];
    let byName = false;
    let byType = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const text = String(arg?.toString?.() || "");
        const lower = text.toLowerCase();
        const typeText = String(arg?.getType?.()?.toString?.() || "").toLowerCase();

        const nameHit = text.startsWith("%AM") || text.startsWith("%AC")
            || lower.includes("callback")
            || lower.includes("handler")
            || lower.includes("listener");
        const typeHit = typeText.includes("function")
            || typeText.includes("callable")
            || typeText.includes("=>");

        if (nameHit || typeHit) {
            indexes.push(i);
            if (nameHit) byName = true;
            if (typeHit) byType = true;
        }
    }

    if (byName && byType) return { indexes, evidence: "both" };
    if (byType) return { indexes, evidence: "type" };
    if (byName) return { indexes, evidence: "name" };
    return { indexes, evidence: "none" };
}

function createScene(repo: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(repo);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const aggregateByKey = new Map<string, SignatureAggregate>();
    const methodBySignature = new Map<string, MethodAggregate>();
    let totalMethods = 0;
    let totalInvokeSites = 0;

    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) continue;
        const sourceAbsNorm = sourceAbs.replace(/\\/g, "/").toLowerCase();
        const scene = createScene(options.repo);
        const methods = scene.getMethods();
        totalMethods += methods.length;

        for (const method of methods) {
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            const callerSignature = method.getSignature?.().toString?.() || "";
            const callerMethod = method.getName?.() || "";
            const callerFile = extractArkFileFromSignature(callerSignature);
            if (callerFile) {
                const callerAbsNorm = path.resolve(options.repo, callerFile).replace(/\\/g, "/").toLowerCase();
                if (!callerAbsNorm.startsWith(sourceAbsNorm)) {
                    continue;
                }
            }

            if (callerSignature) {
                methodBySignature.set(callerSignature, {
                    signature: callerSignature,
                    methodName: callerMethod,
                    classSignature: method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "",
                    className: method.getDeclaringArkClass?.()?.getName?.() || "",
                    filePath: callerFile,
                });
            }

            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr();
                const invokeKind = resolveInvokeKind(invokeExpr);
                if (!invokeKind) continue;
                const signature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
                if (!signature) continue;
                totalInvokeSites++;

                const methodName = extractMethodName(signature);
                const classSignature = invokeExpr.getMethodSignature?.()?.getDeclaringClassSignature?.()?.toString?.() || "";
                const className = invokeExpr.getMethodSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                const argCount = args.length;
                const callbackMeta = inferCallbackArgMeta(args);
                const key = `${signature}|${invokeKind}|${argCount}`;

                if (!aggregateByKey.has(key)) {
                    aggregateByKey.set(key, {
                        signature,
                        methodName,
                        classSignature,
                        className,
                        invokeKind,
                        argCount,
                        callbackArgIndexes: callbackMeta.indexes,
                        callbackArgEvidence: callbackMeta.evidence,
                        count: 0,
                        samples: [],
                    });
                }

                const entry = aggregateByKey.get(key)!;
                entry.count += 1;

                if (entry.callbackArgIndexes.length === 0 && callbackMeta.indexes.length > 0) {
                    entry.callbackArgIndexes = callbackMeta.indexes;
                    entry.callbackArgEvidence = callbackMeta.evidence;
                } else if (entry.callbackArgEvidence !== "both" && callbackMeta.evidence === "both") {
                    entry.callbackArgEvidence = "both";
                }

                if (entry.samples.length < options.maxSamplesPerSignature) {
                    const line = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
                    const invokeText = stmt.toString?.() || "";
                    entry.samples.push({
                        sourceDir,
                        callerSignature,
                        callerMethod,
                        callerFile,
                        line,
                        invokeText,
                    });
                }
            }
        }
    }

    const signatures = Array.from(aggregateByKey.values())
        .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
    const methods = Array.from(methodBySignature.values())
        .sort((a, b) => a.signature.localeCompare(b.signature));

    const report: SignatureDumpReport = {
        generatedAt: new Date().toISOString(),
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        totalMethods,
        totalInvokeSites,
        uniqueSignatures: signatures.length,
        methods,
        signatures,
    };

    const outDir = path.dirname(options.output);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

    console.log("====== SDK Signature Dump ======");
    console.log(`repo=${options.repo}`);
    console.log(`sourceDirs=${options.sourceDirs.join(", ")}`);
    console.log(`totalMethods=${totalMethods}`);
    console.log(`totalInvokeSites=${totalInvokeSites}`);
    console.log(`uniqueMethods=${methods.length}`);
    console.log(`uniqueSignatures=${signatures.length}`);
    console.log(`output=${options.output}`);
}

main();
