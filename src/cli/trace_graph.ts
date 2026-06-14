import * as fs from "fs";
import * as path from "path";
import { diffTraceGraphs } from "../core/trace/TraceGraphDiff";
import { FlowQuery, queryTraceGraphMany } from "../core/trace/TraceGraphQuery";
import { TraceGraph } from "../core/trace/TraceGraph";
import { explainTraceResults } from "../core/trace/TraceExplain";

interface Options {
    mode: "query" | "diff";
    graphPath?: string;
    beforePath?: string;
    afterPath?: string;
    queryPath?: string;
    outputDir: string;
    projectRoot?: string;
    sourceRoot?: string;
}

function parseArgs(argv: string[]): Options {
    let mode: Options["mode"] | undefined;
    let graphPath: string | undefined;
    let beforePath: string | undefined;
    let afterPath: string | undefined;
    let queryPath: string | undefined;
    let outputDir = "";
    let projectRoot: string | undefined;
    let sourceRoot: string | undefined;

    const readValue = (arg: string, next: string | undefined, key: string): { matched: boolean; value?: string; consume: boolean } => {
        if (arg === key) return { matched: true, value: next, consume: true };
        if (arg.startsWith(`${key}=`)) return { matched: true, value: arg.slice(key.length + 1), consume: false };
        return { matched: false, consume: false };
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : undefined;
        if (arg === "query" || arg === "diff") {
            mode = arg;
            continue;
        }
        const graph = readValue(arg, next, "--graph");
        if (graph.matched) {
            graphPath = graph.value;
            if (graph.consume) i++;
            continue;
        }
        const before = readValue(arg, next, "--before");
        if (before.matched) {
            beforePath = before.value;
            if (before.consume) i++;
            continue;
        }
        const after = readValue(arg, next, "--after");
        if (after.matched) {
            afterPath = after.value;
            if (after.consume) i++;
            continue;
        }
        const query = readValue(arg, next, "--queries");
        if (query.matched) {
            queryPath = query.value;
            if (query.consume) i++;
            continue;
        }
        const out = readValue(arg, next, "--outputDir");
        if (out.matched) {
            outputDir = out.value || "";
            if (out.consume) i++;
            continue;
        }
        const project = readValue(arg, next, "--projectRoot");
        if (project.matched) {
            projectRoot = project.value;
            if (project.consume) i++;
            continue;
        }
        const source = readValue(arg, next, "--sourceRoot");
        if (source.matched) {
            sourceRoot = source.value;
            if (source.consume) i++;
            continue;
        }
        throw new Error(`unknown trace_graph option: ${arg}`);
    }

    if (!mode) throw new Error("missing mode: query or diff");
    if (!queryPath) throw new Error("missing --queries <file>");
    if (mode === "query" && !graphPath) throw new Error("query requires --graph <full_trace_graph.json>");
    if (mode === "diff" && (!beforePath || !afterPath)) throw new Error("diff requires --before and --after");
    if (!outputDir) outputDir = path.resolve("tmp", "trace_graph_cli", `${Date.now()}`);
    return {
        mode,
        graphPath: graphPath ? path.resolve(graphPath) : undefined,
        beforePath: beforePath ? path.resolve(beforePath) : undefined,
        afterPath: afterPath ? path.resolve(afterPath) : undefined,
        queryPath: path.resolve(queryPath),
        outputDir: path.resolve(outputDir),
        projectRoot: projectRoot ? path.resolve(projectRoot) : undefined,
        sourceRoot: sourceRoot ? path.resolve(sourceRoot) : undefined,
    };
}

function readGraph(filePath: string): TraceGraph {
    const graph = JSON.parse(fs.readFileSync(filePath, "utf-8")) as TraceGraph;
    if (graph.format !== "arktaint-full-trace-graph") {
        throw new Error(`not an ArkTaint full trace graph: ${filePath}`);
    }
    return graph;
}

function readQueries(filePath: string): FlowQuery[] {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (Array.isArray(raw)) return raw as FlowQuery[];
    if (Array.isArray(raw.queries)) return raw.queries as FlowQuery[];
    throw new Error(`query file must be an array or { queries: [...] }: ${filePath}`);
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export function runTraceGraphCli(argv: string[]): void {
    const options = parseArgs(argv);
    const queries = readQueries(options.queryPath!);
    if (options.mode === "query") {
        const graph = readGraph(options.graphPath!);
        const rawResults = queryTraceGraphMany(graph, queries);
        const results = explainTraceResults(graph, queries, rawResults, {
            projectRoot: options.projectRoot,
            sourceRoot: options.sourceRoot,
        });
        writeJson(path.join(options.outputDir, "flow_query_results.json"), {
            graphRunId: graph.run.runId,
            results,
        });
        return;
    }
    const before = readGraph(options.beforePath!);
    const after = readGraph(options.afterPath!);
    const diff = diffTraceGraphs(before, after, queries);
    for (const item of diff.flowQueryDiffs) {
        const query = queries.find(candidate => candidate.id === item.queryId);
        if (!query) continue;
        item.before = explainTraceResults(before, [query], [item.before], {
            projectRoot: options.projectRoot,
            sourceRoot: options.sourceRoot,
        })[0];
        item.after = explainTraceResults(after, [query], [item.after], {
            projectRoot: options.projectRoot,
            sourceRoot: options.sourceRoot,
        })[0];
    }
    writeJson(path.join(options.outputDir, "trace_diff.json"), diff);
}

if (require.main === module) {
    try {
        runTraceGraphCli(process.argv.slice(2));
    } catch (error: any) {
        console.error(error?.message || String(error));
        process.exit(1);
    }
}
