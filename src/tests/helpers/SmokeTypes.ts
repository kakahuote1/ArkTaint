export interface SmokeProjectConfig {
    id: string;
    repoPath: string;
    repoUrl?: string;
    license?: string;
    sourceMode?: "single" | "multi-module";
    priority?: "main" | "stress";
    commit?: string;
    sourceDirs: string[];
    tags?: string[];
    entryHints?: string[];
    includePaths?: string[];
    excludePaths?: string[];
    sinkSignatures?: string[];
    enabled?: boolean;
}

export interface SmokeManifest {
    projects: SmokeProjectConfig[];
}

export interface CliOptions {
    manifestPath: string;
    k: number;
    maxEntries: number;
    outputDir: string;
    projectFilter?: string;
}

export interface ResolvedEntry {
    name: string;
    pathHint?: string;
}

export interface EntryCandidate extends ResolvedEntry {
    signature: string;
    score: number;
    sourceDir: string;
    sourceFile?: string;
}

export interface EntrySmokeResult {
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    signature: string;
    score: number;
    status: "ok" | "no_entry" | "no_body" | "no_seed" | "exception";
    seedLocalNames: string[];
    seedStrategies: string[];
    seedCount: number;
    flowCount: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    sinkSamples: string[];
    error?: string;
    elapsedMs: number;
}

export interface SourceDirSummary {
    sourceDir: string;
    candidatePoolTotal: number;
    candidateAfterPathFilter: number;
    selected: number;
    entryCoverageRate: number;
    filePoolTotal: number;
    fileAfterPathFilter: number;
    fileCovered: number;
    fileCoverageRate: number;
    analyzed: number;
    withSeeds: number;
    withFlows: number;
    totalFlows: number;
    statusCount: Record<string, number>;
}

export interface ProjectSmokeResult {
    id: string;
    repoPath: string;
    repoUrl?: string;
    license?: string;
    sourceMode?: "single" | "multi-module";
    priority?: "main" | "stress";
    commit?: string;
    tags: string[];
    sourceDirs: string[];
    sourceSummaries: SourceDirSummary[];
    entries: EntrySmokeResult[];
    sinkSignatures: string[];
    analyzed: number;
    withSeeds: number;
    withFlows: number;
    totalFlows: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    fatalErrors: string[];
}

export interface SmokeReport {
    generatedAt: string;
    options: CliOptions;
    projects: ProjectSmokeResult[];
    totalProjects: number;
    totalAnalyzedEntries: number;
    totalEntriesWithSeeds: number;
    totalEntriesWithFlows: number;
    totalFlows: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    fatalProjectCount: number;
}

export interface CandidateSelectorOptions {
    includePaths: string[];
    excludePaths: string[];
    entryHints: string[];
}

export interface CandidateSelectionResult {
    selected: EntryCandidate[];
    poolTotal: number;
    filteredTotal: number;
    poolFileCount: number;
    filteredFileCount: number;
    selectedFileCount: number;
}
