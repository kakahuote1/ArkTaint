import { TaintRuleSet } from "../core/rules/RuleSchema";

export interface LlmCandidateRunMeta {
    generatedAtIso: string;
    inputPath: string;
    outputPath: string;
    model?: string;
    repoRoot?: string;
    sourceDirs: string[];
    sliceEnriched: boolean;
    inputItemCount: number;
    itemsWithContextSlices: number;
    itemsWithContextError: number;
    evidenceAck?: string[];
}

function countContextStats(candidates: unknown[]): { withSlices: number; withError: number } {
    let withSlices = 0;
    let withError = 0;
    for (const raw of candidates) {
        const c = raw as { contextSlices?: unknown[]; contextError?: string };
        if (Array.isArray(c.contextSlices) && c.contextSlices.length > 0) {
            withSlices++;
        }
        if (typeof c.contextError === "string" && c.contextError.trim()) {
            withError++;
        }
    }
    return { withSlices, withError };
}

function escCell(s: string): string {
    return String(s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function ruleRows(ruleSet: TaintRuleSet): string {
    const rows: string[] = [];
    const push = (kind: string, r: { id: string; enabled?: boolean; match?: { kind?: string; value?: string }; description?: string }) => {
        const en = r.enabled === false ? "no" : "yes";
        const mk = r.match?.kind || "";
        const mv = (r.match?.value || "").slice(0, 120);
        rows.push(`| ${escCell(kind)} | ${escCell(r.id)} | ${en} | ${escCell(mk)} | ${escCell(mv)} |`);
    };
    for (const r of ruleSet.sources || []) push("source", r);
    for (const r of ruleSet.sinks || []) push("sink", r);
    for (const r of ruleSet.transfers || []) push("transfer", r);
    for (const r of ruleSet.sanitizers || []) push("sanitizer", r);
    if (rows.length === 0) {
        return "| (none) | | | | |\n";
    }
    return rows.join("\n") + "\n";
}

export function renderLlmCandidateRulesReportMarkdown(input: {
    meta: LlmCandidateRunMeta;
    ruleSet: TaintRuleSet;
    candidates: unknown[];
}): string {
    const { withSlices, withError } = countContextStats(input.candidates);
    const m = input.meta;
    const counts = {
        sources: (input.ruleSet.sources || []).length,
        sinks: (input.ruleSet.sinks || []).length,
        transfers: (input.ruleSet.transfers || []).length,
        sanitizers: (input.ruleSet.sanitizers || []).length,
        enabledSources: (input.ruleSet.sources || []).filter(r => r.enabled !== false).length,
        enabledSinks: (input.ruleSet.sinks || []).filter(r => r.enabled !== false).length,
        enabledTransfers: (input.ruleSet.transfers || []).filter(r => r.enabled !== false).length,
        enabledSanitizers: (input.ruleSet.sanitizers || []).filter(r => r.enabled !== false).length,
    };

    const ack = (m.evidenceAck || []).map((line, i) => `${i + 1}. ${line}`).join("\n") || "_（无）_";

    return [
        "# LLM 候选污点规则 — 审查报告",
        "",
        `生成时间（UTC 风格本地 ISO）：\`${m.generatedAtIso}\``,
        "",
        "## 流水线摘要",
        "",
        "| 字段 | 值 |",
        "| --- | --- |",
        `| 输入证据 | \`${escCell(m.inputPath)}\` |`,
        `| 规则输出 | \`${escCell(m.outputPath)}\` |`,
        `| 模型 | ${escCell(m.model || "") || "—"} |`,
        `| 仓库根 | ${m.repoRoot ? `\`${escCell(m.repoRoot)}\`` : "—"} |`,
        `| 源码目录（相对 repo） | ${m.sourceDirs.length ? m.sourceDirs.map(d => `\`${d}\``).join(", ") : "—"} |`,
        `| 调用点切片 enrich | ${m.sliceEnriched ? "是" : "否"} |`,
        `| 输入条目数 | ${m.inputItemCount} |`,
        `| 含 contextSlices 的条目 | ${withSlices} |`,
        `| 含 contextError 的条目 | ${withError} |`,
        "",
        "## 规则数量（门控后）",
        "",
        "| 类型 | 总数 | enabled |",
        "| --- | ---: | ---: |",
        `| sources | ${counts.sources} | ${counts.enabledSources} |`,
        `| sinks | ${counts.sinks} | ${counts.enabledSinks} |`,
        `| transfers | ${counts.transfers} | ${counts.enabledTransfers} |`,
        `| sanitizers | ${counts.sanitizers} | ${counts.enabledSanitizers} |`,
        "",
        "## 模型证据摘要（evidenceAck）",
        "",
        ack,
        "",
        "## 规则一览（用于人工抽检）",
        "",
        "| kind | id | enabled | match.kind | match.value（截断） |",
        "| --- | --- | --- | --- | --- |",
        ruleRows(input.ruleSet),
        "",
        "## 落地到工程规则的推荐步骤",
        "",
        "1. **先跑回归**：将 `enabled: true` 的规则合并进 `src/rules/**/project/` 下对应 JSON，重新执行分析/测试。",
        "2. **优先 transfers**：项目内包装/API 桥接多数是 transfer；source/sink 需对照隐私边界再启用。",
        "3. **被门控为 disabled 的规则**：阅读 `match` 与 `scope`；若语义明确，可补全 `scope` / `signature_equals` 后再手动 `enabled: true`。",
        "4. **使用分类后的候选池**（若已生成）：优先用 `no_candidate_project_candidates.json`（仅 C2 项目包装类）作为 LLM 输入，减少 UI 噪声。",
        "",
        "---",
        "_本报告由 `generate_llm_candidate_rules` 自动生成。_",
        "",
    ].join("\n");
}

export function splitTaintRuleSetFiles(ruleSet: TaintRuleSet): {
    sources: TaintRuleSet;
    sinks: TaintRuleSet;
    transfers: TaintRuleSet;
    sanitizers: TaintRuleSet;
} {
    const base = {
        schemaVersion: "2.0" as const,
        meta: ruleSet.meta ? { ...ruleSet.meta } : undefined,
    };
    return {
        sources: { ...base, sources: ruleSet.sources || [], sinks: [], transfers: [], sanitizers: [] },
        sinks: { ...base, sources: [], sinks: ruleSet.sinks || [], transfers: [], sanitizers: [] },
        transfers: { ...base, sources: [], sinks: [], transfers: ruleSet.transfers || [], sanitizers: [] },
        sanitizers: { ...base, sources: [], sinks: [], transfers: [], sanitizers: ruleSet.sanitizers || [] },
    };
}
