import * as fs from "fs";
import * as path from "path";

type StateBlock = Record<string, unknown>;

export interface ContextPackCliOptions {
    goal?: string;
    constraints?: string[];
    statePath?: string;
    rawPath?: string;
    outPath?: string;
    maxChars?: number;
    generatedAt?: string;
}

export interface BuildContextPackInput {
    goal?: string;
    constraints?: string[];
    state: StateBlock;
    rawText: string;
    generatedAt: string;
}

export interface ContextPackTruncation {
    reason: string;
    max_chars?: number;
    dropped_sections?: string[];
}

export interface ContextPack {
    generatedAt: string;
    goal?: string;
    constraints: string[];
    /** Original merged state (all keys as provided). */
    state: StateBlock;
    /** Canonical keys for export: goal, constraints, active_skills, plus passthrough. */
    normalizedState: StateBlock;
    truncation?: ContextPackTruncation;
    extractedSignals: {
        decisions: string[];
        openQuestions: string[];
        nextActions: string[];
        hypotheses: string[];
    };
    artifacts: {
        filesTouched: string[];
        lastCommands: Array<{ cmd: string; result?: string; note?: string }>;
    };
}

export interface RenderBudgetOptions {
    maxChars?: number;
}

interface RenderCaps {
    signalCap: number;
    filesCap: number;
    cmdsCap: number;
    stateMode: "full" | "must_keep";
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

export function parseContextPackArgs(argv: string[]): ContextPackCliOptions {
    const options: ContextPackCliOptions = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--goal" && argv[i + 1]) {
            options.goal = argv[++i];
        } else if (arg.startsWith("--goal=")) {
            options.goal = arg.slice("--goal=".length);
        } else if (arg === "--constraint" && argv[i + 1]) {
            options.constraints = options.constraints ?? [];
            options.constraints.push(argv[++i]);
        } else if (arg.startsWith("--constraint=")) {
            options.constraints = options.constraints ?? [];
            options.constraints.push(arg.slice("--constraint=".length));
        } else if (arg === "--state" && argv[i + 1]) {
            options.statePath = argv[++i];
        } else if (arg.startsWith("--state=")) {
            options.statePath = arg.slice("--state=".length);
        } else if (arg === "--raw" && argv[i + 1]) {
            options.rawPath = argv[++i];
        } else if (arg.startsWith("--raw=")) {
            options.rawPath = arg.slice("--raw=".length);
        } else if (arg === "--out" && argv[i + 1]) {
            options.outPath = argv[++i];
        } else if (arg.startsWith("--out=")) {
            options.outPath = arg.slice("--out=".length);
        } else if (arg === "--max-chars" && argv[i + 1]) {
            options.maxChars = Number(argv[++i]);
        } else if (arg.startsWith("--max-chars=")) {
            options.maxChars = Number(arg.slice("--max-chars=".length));
        } else if (arg === "--generated-at" && argv[i + 1]) {
            options.generatedAt = argv[++i];
        } else if (arg.startsWith("--generated-at=")) {
            options.generatedAt = arg.slice("--generated-at=".length);
        }
    }
    return options;
}

function readJsonIfExists(absPath: string): StateBlock | undefined {
    if (!fs.existsSync(absPath)) return undefined;
    const raw = fs.readFileSync(absPath, "utf-8");
    return JSON.parse(raw) as StateBlock;
}

export function dedupeKeepOrder(items: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items.map(s => s.trim()).filter(Boolean)) {
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

export function extractSignalsFromRaw(raw: string): {
    decisions: string[];
    openQuestions: string[];
    nextActions: string[];
    hypotheses: string[];
} {
    const decisions: string[] = [];
    const openQuestions: string[] = [];
    const nextActions: string[] = [];
    const hypotheses: string[] = [];

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const s = line.trim();
        if (!s) continue;

        if (/^(decision|决定|结论|已决定)\b/i.test(s) || /=>\s*decision/i.test(s)) {
            decisions.push(s.replace(/^(decision|决定|结论|已决定)\s*[:：-]?\s*/i, ""));
        } else if (/^(open question|问题|未决)\b/i.test(s) || s.endsWith("?") || s.endsWith("？")) {
            openQuestions.push(s.replace(/^(open question|问题|未决)\s*[:：-]?\s*/i, ""));
        } else if (/^(next|todo|下一步|行动项)\b/i.test(s)) {
            nextActions.push(s.replace(/^(next|todo|下一步|行动项)\s*[:：-]?\s*/i, ""));
        } else if (/^(hypothesis|假设)\b/i.test(s)) {
            hypotheses.push(s.replace(/^(hypothesis|假设)\s*[:：-]?\s*/i, ""));
        }
    }

    return {
        decisions: dedupeKeepOrder(decisions),
        openQuestions: dedupeKeepOrder(openQuestions),
        nextActions: dedupeKeepOrder(nextActions),
        hypotheses: dedupeKeepOrder(hypotheses),
    };
}

function buildNormalizedState(raw: StateBlock, resolvedGoal: string | undefined, resolvedConstraints: string[]): StateBlock {
    const activeRaw = raw.active_skills ?? raw.activeSkills;
    const active = Array.isArray(activeRaw)
        ? dedupeKeepOrder(activeRaw.map(x => String(x)))
        : [];
    const g = resolvedGoal ?? (raw.goal as string | undefined) ?? (raw.Goal as string | undefined);
    const fromStateCons = Array.isArray(raw.constraints) ? raw.constraints.map(x => String(x)) : [];
    const cons = resolvedConstraints.length > 0 ? resolvedConstraints : dedupeKeepOrder(fromStateCons);

    const out: StateBlock = {
        goal: g,
        constraints: cons,
        active_skills: active,
    };
    for (const [k, v] of Object.entries(raw)) {
        if (["goal", "Goal", "constraints", "active_skills", "activeSkills"].includes(k)) continue;
        out[k] = v;
    }
    return out;
}

export function buildContextPack(input: BuildContextPackInput): ContextPack {
    const state = input.state;
    const constraints = dedupeKeepOrder([
        ...(input.constraints ?? []),
        ...(Array.isArray(state.constraints) ? state.constraints.map(x => String(x)) : []),
    ]);
    const goal = input.goal ?? (state.goal as string | undefined) ?? (state.Goal as string | undefined);
    const extracted = extractSignalsFromRaw(input.rawText);

    const mergedDecisions = dedupeKeepOrder([
        ...(Array.isArray(state.decisions) ? state.decisions.map(x => String(x)) : []),
        ...extracted.decisions,
    ]);
    const mergedOpen = dedupeKeepOrder([
        ...(Array.isArray(state.open_questions) ? state.open_questions.map(x => String(x)) : []),
        ...(Array.isArray(state.openQuestions) ? state.openQuestions.map(x => String(x)) : []),
        ...extracted.openQuestions,
    ]);
    const mergedNext = dedupeKeepOrder([
        ...(Array.isArray(state.next_actions) ? state.next_actions.map(x => String(x)) : []),
        ...(Array.isArray(state.nextActions) ? state.nextActions.map(x => String(x)) : []),
        ...extracted.nextActions,
    ]);
    const mergedHyp = dedupeKeepOrder([
        ...(Array.isArray(state.hypotheses) ? state.hypotheses.map(x => String(x)) : []),
        ...extracted.hypotheses,
    ]);

    const filesTouched = dedupeKeepOrder(
        Array.isArray(state.files_touched) ? state.files_touched.map(x => String(x))
            : Array.isArray(state.filesTouched) ? state.filesTouched.map(x => String(x))
                : []
    );
    const lastCommands = Array.isArray(state.last_commands) ? state.last_commands as ContextPack["artifacts"]["lastCommands"]
        : Array.isArray(state.lastCommands) ? state.lastCommands as ContextPack["artifacts"]["lastCommands"]
            : [];

    const normalizedState = buildNormalizedState(state, goal, constraints);

    return {
        generatedAt: input.generatedAt,
        goal,
        constraints,
        state,
        normalizedState,
        extractedSignals: {
            decisions: mergedDecisions,
            openQuestions: mergedOpen,
            nextActions: mergedNext,
            hypotheses: mergedHyp,
        },
        artifacts: {
            filesTouched,
            lastCommands,
        },
    };
}

function renderMarkdownWithCaps(pack: ContextPack, caps: RenderCaps, truncation?: ContextPackTruncation): string {
    const lines: string[] = [];
    lines.push("# Context Handoff Pack");
    lines.push("");
    lines.push(`- generatedAt: ${pack.generatedAt}`);
    if (pack.goal) lines.push(`- goal: ${pack.goal}`);
    if (pack.constraints.length > 0) {
        lines.push(`- constraints: ${pack.constraints.length}`);
    }
    lines.push("");

    lines.push("## Rolling Summary");
    lines.push("");

    lines.push("### Goal");
    lines.push("");
    lines.push(pack.goal ? `- ${pack.goal}` : "- (not provided)");
    lines.push("");

    lines.push("### Constraints");
    lines.push("");
    if (pack.constraints.length === 0) {
        lines.push("- none");
    } else {
        for (const c of pack.constraints) lines.push(`- ${c}`);
    }
    lines.push("");

    const sections: Array<[string, string[]]> = [
        ["Decisions", pack.extractedSignals.decisions],
        ["Open questions", pack.extractedSignals.openQuestions],
        ["Next actions", pack.extractedSignals.nextActions],
        ["Hypotheses", pack.extractedSignals.hypotheses],
    ];
    for (const [title, items] of sections) {
        lines.push(`### ${title}`);
        lines.push("");
        const cap = caps.signalCap;
        if (items.length === 0 || cap <= 0) {
            lines.push("- none");
        } else {
            for (const item of items.slice(0, cap)) {
                lines.push(`- ${item}`);
            }
        }
        lines.push("");
    }

    lines.push("## Artifacts");
    lines.push("");

    lines.push("### Files touched");
    lines.push("");
    const fc = caps.filesCap;
    if (pack.artifacts.filesTouched.length === 0 || fc <= 0) {
        lines.push("- none");
    } else {
        for (const f of pack.artifacts.filesTouched.slice(0, fc)) lines.push(`- ${f}`);
    }
    lines.push("");

    lines.push("### Last commands");
    lines.push("");
    const cc = caps.cmdsCap;
    if (pack.artifacts.lastCommands.length === 0 || cc <= 0) {
        lines.push("- none");
    } else {
        for (const c of pack.artifacts.lastCommands.slice(0, cc)) {
            const suffix = [c.result ? `result=${c.result}` : undefined, c.note ? `note=${c.note}` : undefined].filter(Boolean).join(", ");
            lines.push(`- ${c.cmd}${suffix ? ` (${suffix})` : ""}`);
        }
    }
    lines.push("");

    lines.push("## State Block (JSON)");
    lines.push("");
    lines.push("```json");
    let stateForJson: StateBlock;
    if (caps.stateMode === "full") {
        stateForJson = { ...pack.normalizedState };
        if (truncation) {
            stateForJson.truncation = truncation;
        }
    } else {
        stateForJson = {
            goal: pack.normalizedState.goal,
            constraints: pack.normalizedState.constraints,
            active_skills: pack.normalizedState.active_skills,
            truncation: truncation ?? {
                reason: "max_chars_state_must_keep",
            },
        };
    }
    lines.push(JSON.stringify(stateForJson, null, 2));
    lines.push("```");
    lines.push("");

    return lines.join("\n");
}

export function renderContextPackMarkdown(pack: ContextPack, budget: RenderBudgetOptions): {
    markdown: string;
    truncation?: ContextPackTruncation;
} {
    const maxChars = budget.maxChars;
    let caps: RenderCaps = { signalCap: 12, filesCap: 30, cmdsCap: 20, stateMode: "full" };
    let truncation: ContextPackTruncation | undefined;

    const tryRender = (): string => renderMarkdownWithCaps(pack, caps, truncation);

    if (!maxChars || maxChars <= 0) {
        return { markdown: tryRender(), truncation: undefined };
    }

    let md = tryRender();
    const dropped: string[] = [];

    const shrink = (): boolean => {
        if (caps.signalCap > 0) {
            caps.signalCap--;
            dropped.push("rolling_summary_signals");
            return true;
        }
        if (caps.filesCap > 0) {
            caps.filesCap--;
            dropped.push("artifacts_files_touched");
            return true;
        }
        if (caps.cmdsCap > 0) {
            caps.cmdsCap--;
            dropped.push("artifacts_last_commands");
            return true;
        }
        if (caps.stateMode === "full") {
            caps.stateMode = "must_keep";
            dropped.push("state_block_full");
            return true;
        }
        return false;
    };

    while (md.length > maxChars && shrink()) {
        truncation = {
            reason: "max_chars",
            max_chars: maxChars,
            dropped_sections: [...dropped],
        };
        md = tryRender();
    }

    if (md.length > maxChars) {
        truncation = {
            reason: "max_chars_hard_minimal",
            max_chars: maxChars,
            dropped_sections: [...dropped, "markdown_minimal_fallback"],
        };
        const minimal = [
            "# Context Handoff Pack",
            "",
            `- generatedAt: ${pack.generatedAt}`,
            pack.goal ? `- goal: ${pack.goal}` : "- goal: (not provided)",
            "## State Block (JSON)",
            "",
            "```json",
            JSON.stringify({
                goal: pack.normalizedState.goal,
                constraints: pack.normalizedState.constraints,
                active_skills: pack.normalizedState.active_skills,
                truncation,
            }, null, 2),
            "```",
            "",
        ].join("\n");
        md = minimal;
    }

    return { markdown: md, truncation };
}

function main(): void {
    const options = parseContextPackArgs(process.argv.slice(2));

    const stateAbs = options.statePath ? path.resolve(options.statePath) : undefined;
    const rawAbs = options.rawPath ? path.resolve(options.rawPath) : undefined;
    const outAbs = options.outPath ? path.resolve(options.outPath) : undefined;

    const state: StateBlock = stateAbs ? (readJsonIfExists(stateAbs) ?? {}) : {};
    const rawText = rawAbs && fs.existsSync(rawAbs) ? fs.readFileSync(rawAbs, "utf-8") : "";
    const generatedAt = options.generatedAt ?? new Date().toISOString();

    const pack = buildContextPack({
        goal: options.goal,
        constraints: options.constraints,
        state,
        rawText,
        generatedAt,
    });

    const { markdown: md, truncation } = renderContextPackMarkdown(pack, { maxChars: options.maxChars });
    const packForJson = truncation ? { ...pack, truncation } : pack;

    const outDir = path.resolve("tmp", "test_runs", "_context", "latest");
    ensureDir(outDir);
    const jsonPath = path.join(outDir, "context_pack.json");
    const mdPath = path.join(outDir, "context_handoff.md");
    fs.writeFileSync(jsonPath, JSON.stringify(packForJson, null, 2), "utf-8");
    fs.writeFileSync(mdPath, md, "utf-8");

    if (outAbs) {
        ensureDir(path.dirname(outAbs));
        fs.writeFileSync(outAbs, md, "utf-8");
    }

    console.log("====== Context Pack ======");
    console.log(`goal=${pack.goal ?? "(not provided)"}`);
    console.log(`constraints=${pack.constraints.length}`);
    console.log(`out_json=${jsonPath}`);
    console.log(`out_md=${mdPath}`);
    if (outAbs) console.log(`out_custom=${outAbs}`);
}

if (require.main === module) {
    main();
}
