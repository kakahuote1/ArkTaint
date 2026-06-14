import * as fs from "fs";
import * as path from "path";
import { WorklistProfiler, WorklistProfileSnapshot } from "./WorklistProfiler";
import {
    TraceGraph,
    TraceGraphRecorder,
    writeTraceGraphArtifacts,
} from "../../trace/TraceGraph";

export interface DebugCollectorOptions {
    enableWorklistProfile?: boolean;
    enableTraceGraph?: boolean;
    traceRun?: ConstructorParameters<typeof TraceGraphRecorder>[0]["run"];
}

export interface DebugCollectors {
    worklistProfiler?: WorklistProfiler;
    traceGraph?: TraceGraphRecorder;
}

export function createDebugCollectors(debug?: DebugCollectorOptions): DebugCollectors {
    const worklistProfiler = debug?.enableWorklistProfile ? new WorklistProfiler() : undefined;
    const traceGraph = debug?.enableTraceGraph
        ? new TraceGraphRecorder({ run: debug.traceRun })
        : undefined;
    return { worklistProfiler, traceGraph };
}

export function dumpDebugArtifactsToDir(args: {
    tag: string;
    outputDir?: string;
    profile?: WorklistProfileSnapshot;
    traceGraph?: TraceGraph;
}): { profilePath?: string; traceGraphJsonPath?: string; traceGraphMarkdownPath?: string } {
    const out: { profilePath?: string; traceGraphJsonPath?: string; traceGraphMarkdownPath?: string } = {};
    const outputDir = args.outputDir || "tmp";
    const safeTag = args.tag.replace(/[^A-Za-z0-9_.-]/g, "_");
    fs.mkdirSync(outputDir, { recursive: true });

    if (args.profile) {
        const profilePath = path.join(outputDir, `worklist_profile_${safeTag}.json`);
        fs.writeFileSync(profilePath, JSON.stringify(args.profile, null, 2), "utf-8");
        out.profilePath = profilePath;
    }

    if (args.traceGraph) {
        const traceDir = path.join(outputDir, `trace_graph_${safeTag}`);
        const paths = writeTraceGraphArtifacts(traceDir, args.traceGraph);
        out.traceGraphJsonPath = paths.jsonPath;
        out.traceGraphMarkdownPath = paths.markdownPath;
    }

    return out;
}
