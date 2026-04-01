import * as fs from "fs";
import * as path from "path";
import { WorklistProfiler, WorklistProfileSnapshot } from "./WorklistProfiler";
import { PropagationTrace } from "./PropagationTrace";

export interface DebugCollectorOptions {
    enableWorklistProfile?: boolean;
    enablePropagationTrace?: boolean;
    propagationTraceMaxEdges?: number;
}

export interface DebugCollectors {
    worklistProfiler?: WorklistProfiler;
    propagationTrace?: PropagationTrace;
}

export function createDebugCollectors(debug?: DebugCollectorOptions): DebugCollectors {
    const worklistProfiler = debug?.enableWorklistProfile ? new WorklistProfiler() : undefined;
    const propagationTrace = debug?.enablePropagationTrace
        ? new PropagationTrace({ maxEdges: debug?.propagationTraceMaxEdges })
        : undefined;
    return { worklistProfiler, propagationTrace };
}

export function dumpDebugArtifactsToDir(args: {
    tag: string;
    outputDir?: string;
    profile?: WorklistProfileSnapshot;
    dot?: string;
}): { profilePath?: string; dotPath?: string } {
    const out: { profilePath?: string; dotPath?: string } = {};
    const outputDir = args.outputDir || "tmp";
    const safeTag = args.tag.replace(/[^A-Za-z0-9_.-]/g, "_");
    fs.mkdirSync(outputDir, { recursive: true });

    if (args.profile) {
        const profilePath = path.join(outputDir, `worklist_profile_${safeTag}.json`);
        fs.writeFileSync(profilePath, JSON.stringify(args.profile, null, 2), "utf-8");
        out.profilePath = profilePath;
    }

    if (args.dot) {
        const dotPath = path.join(outputDir, `taint_trace_${safeTag}.dot`);
        fs.writeFileSync(dotPath, args.dot, "utf-8");
        out.dotPath = dotPath;
    }

    return out;
}
