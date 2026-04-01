import * as fs from "fs";
import * as path from "path";
import { extractErrorLocation } from "../core/orchestration/ExtensionLoaderUtils";
import { AnalyzeErrorDiagnostics, NormalizedAnalyzeDiagnosticItem } from "./analyzeTypes";

interface DiagnosticLocation {
    path?: string;
    line?: number;
    column?: number;
}

export interface NormalizedDiagnosticItem extends DiagnosticLocation, NormalizedAnalyzeDiagnosticItem {}

export interface DiagnosticsJsonArtifact {
    schemaVersion: "1.0";
    itemCount: number;
    items: NormalizedDiagnosticItem[];
    rawDiagnostics: AnalyzeErrorDiagnostics;
}

export interface DiagnosticsArtifactPaths {
    jsonPath: string;
    textPath: string;
}

export interface DiagnosticsRenderOptions {
    maxItems?: number;
    includeHeader?: boolean;
}

export function buildSystemFailureEvent(
    error: unknown,
    options: {
        phase?: string;
        code?: string;
        title?: string;
        summary?: string;
        advice?: string;
    } = {},
): AnalyzeErrorDiagnostics["systemFailures"][number] {
    const location = extractErrorLocation(error);
    const phase = options.phase || "analyze";
    const message = String((error as any)?.message || error);
    const locationSuffix = location.path
        ? location.line && location.column
            ? ` @ ${location.path}:${location.line}:${location.column}`
            : ` @ ${location.path}`
        : "";
    return {
        phase,
        message,
        path: location.path,
        line: location.line,
        column: location.column,
        stackExcerpt: location.stackExcerpt,
        userMessage: `${phase} main flow failed${locationSuffix}: ${message}`,
        code: options.code || `SYSTEM_${normalizeCodeFragment(phase)}_THROW`,
        summary: options.summary || "分析主流程抛出了未归类异常",
        advice: options.advice || "这不是规则、语义包或插件自己的已归类错误。请先查看这里附近的代码和上一条栈信息，再决定是修配置、扩展还是引擎主流程。",
        title: options.title || "分析主流程",
    };
}

function toLocation(location: DiagnosticLocation): string {
    if (!location.path) return "(no file)";
    if (location.line && location.column) {
        return `${location.path}:${location.line}:${location.column}`;
    }
    return location.path;
}

function categoryLabel(category: NormalizedDiagnosticItem["category"]): string {
    switch (category) {
        case "Rule":
            return "规则";
        case "Pack":
            return "语义包";
        case "Plugin":
            return "插件";
        case "System":
            return "系统";
    }
}

function normalizeCodeFragment(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
}

function classifyLegacyLoadMessage(prefix: "PACK" | "PLUGIN", message: string): { code: string; advice: string } {
    const lower = message.toLowerCase();
    if (lower.includes("cannot find module")) {
        return {
            code: `${prefix}_MODULE_LOAD_MODULE_NOT_FOUND`,
            advice: "检查 import/require 路径是否写对，以及依赖文件是否存在。",
        };
    }
    if (
        lower.includes("unexpected token")
        || lower.includes("unexpected end of input")
        || lower.includes("missing )")
        || lower.includes("unterminated")
        || lower.includes("syntaxerror")
    ) {
        return {
            code: `${prefix}_MODULE_LOAD_SYNTAX_ERROR`,
            advice: "检查这个扩展文件附近是否有括号、逗号、字符串或 import 写法错误。",
        };
    }
    if (lower.includes("is not a function")) {
        return {
            code: `${prefix}_MODULE_LOAD_BAD_EXPORT`,
            advice: "检查导出的对象是否真的是合法的 pack/plugin 定义，尤其是 default 导出和命名导出。",
        };
    }
    return {
        code: `${prefix}_MODULE_LOAD_UNKNOWN`,
        advice: "未能自动判断具体错因。请先核对这个扩展文件和相关 import 依赖是否能单独正常执行。",
    };
}

function fallbackPackRuntimeAdvice(phase: string): { code: string; advice: string } {
    return {
        code: `PACK_${normalizeCodeFragment(phase)}_THROW`,
        advice: "这是该 semantic pack 在这个回调里直接抛出的异常。请先检查附近代码、空值访问和 helper 返回值。",
    };
}

function fallbackPluginRuntimeAdvice(phase: string): { code: string; advice: string } {
    return {
        code: `PLUGIN_${normalizeCodeFragment(phase)}_THROW`,
        advice: "这是该 plugin 在这个阶段里直接抛出的异常。请先检查附近代码、空值访问和 helper 返回值。",
    };
}

function describeRuleKind(issue: AnalyzeErrorDiagnostics["ruleLoadIssues"][number]): { code: string; summary: string; advice: string } {
    switch (issue.kind) {
        case "file_missing":
            return {
                code: "RULE_FILE_MISSING",
                summary: "规则文件不存在",
                advice: "检查路径是否写对，或确认该规则文件已经生成。",
            };
        case "json_parse":
            return {
                code: "RULE_JSON_PARSE",
                summary: "规则文件 JSON 语法错误",
                advice: "先检查这里附近是否缺少逗号、右方括号 ] 或右花括号 }。",
            };
        case "schema_assert":
            return {
                code: "RULE_SCHEMA_INVALID",
                summary: "规则结构不合法",
                advice: "按提示检查这个字段是否写成了系统支持的规则结构。",
            };
        case "validation":
            return {
                code: "RULE_FIELD_INVALID",
                summary: "规则字段不合法",
                advice: "检查这个字段的取值范围和类型是否符合规则 schema。",
            };
        case "merged_validation":
            return {
                code: "RULE_MERGED_INVALID",
                summary: "合并后的规则集不合法",
                advice: "检查是否有多个规则文件在合并后产生了冲突或非法组合。",
            };
    }
}

function describePackPhase(phase: string): string {
    switch (phase) {
        case "setup":
            return "初始化";
        case "onFact":
            return "传播回调 onFact";
        case "onInvoke":
            return "调用回调 onInvoke";
        case "shouldSkipCopyEdge":
            return "拷贝边裁剪回调";
        case "module_load":
            return "模块加载";
        default:
            return phase;
    }
}

function describePluginPhase(phase: string): string {
    const map: Record<string, string> = {
        onStart: "启动阶段",
        onEntry: "入口阶段",
        onPropagation: "传播阶段",
        onDetection: "检测阶段",
        onResult: "结果阶段",
        onFinish: "结束阶段",
        "result.filter": "结果过滤",
        "result.transform": "结果转换",
        "propagation.observer": "传播观察器",
        module_load: "模块加载",
    };
    return map[phase] || phase;
}

export function normalizeDiagnosticsItems(diagnostics: AnalyzeErrorDiagnostics): NormalizedDiagnosticItem[] {
    const out: NormalizedDiagnosticItem[] = [];
    for (const issue of diagnostics.ruleLoadIssues) {
        const desc = describeRuleKind(issue);
        out.push({
            category: "Rule",
            code: desc.code,
            title: `${issue.layerName} 规则`,
            summary: desc.summary,
            rawMessage: issue.message,
            advice: desc.advice,
            path: issue.path,
            line: issue.line,
            column: issue.column,
            fieldPath: issue.fieldPath,
        });
    }
    for (const issue of diagnostics.semanticPackLoadIssues) {
        const load = issue.code && issue.advice
            ? { code: issue.code, advice: issue.advice }
            : classifyLegacyLoadMessage("PACK", issue.message);
        out.push({
            category: "Pack",
            code: load.code,
            title: "模块加载",
            summary: "语义包模块加载失败",
            rawMessage: issue.message,
            advice: load.advice,
            path: issue.modulePath,
            line: issue.line,
            column: issue.column,
        });
    }
    for (const failure of diagnostics.semanticPackRuntimeFailures) {
        const phaseLabel = describePackPhase(failure.phase);
        const runtime = failure.code && failure.advice
            ? { code: failure.code, advice: failure.advice }
            : fallbackPackRuntimeAdvice(failure.phase);
        out.push({
            category: "Pack",
            code: runtime.code,
            title: `${failure.packId} / ${phaseLabel}`,
            summary: `语义包 ${failure.packId} 在 ${phaseLabel} 中抛出了异常`,
            rawMessage: failure.message,
            advice: runtime.advice,
            path: failure.path,
            line: failure.line,
            column: failure.column,
        });
    }
    for (const issue of diagnostics.enginePluginLoadIssues) {
        const load = issue.code && issue.advice
            ? { code: issue.code, advice: issue.advice }
            : classifyLegacyLoadMessage("PLUGIN", issue.message);
        out.push({
            category: "Plugin",
            code: load.code,
            title: "模块加载",
            summary: "插件模块加载失败",
            rawMessage: issue.message,
            advice: load.advice,
            path: issue.modulePath,
            line: issue.line,
            column: issue.column,
        });
    }
    for (const failure of diagnostics.enginePluginRuntimeFailures) {
        const phaseLabel = describePluginPhase(failure.phase);
        const runtime = failure.code && failure.advice
            ? { code: failure.code, advice: failure.advice }
            : fallbackPluginRuntimeAdvice(failure.phase);
        out.push({
            category: "Plugin",
            code: runtime.code,
            title: `${failure.pluginName} / ${phaseLabel}`,
            summary: `插件 ${failure.pluginName} 在 ${phaseLabel} 中抛出了异常`,
            rawMessage: failure.message,
            advice: runtime.advice,
            path: failure.path,
            line: failure.line,
            column: failure.column,
        });
    }
    for (const failure of diagnostics.systemFailures || []) {
        out.push({
            category: "System",
            code: failure.code || `SYSTEM_${normalizeCodeFragment(failure.phase || "analyze")}_THROW`,
            title: failure.title || "分析主流程",
            summary: failure.summary || "分析主流程抛出了未归类异常",
            rawMessage: failure.message,
            advice: failure.advice || "这是分析主流程直接抛出的异常。请先查看这里附近的代码和上一条栈信息，再决定是修配置、规则还是引擎本身。",
            path: failure.path,
            line: failure.line,
            column: failure.column,
        });
    }
    return out;
}

function estimateUnderlineWidth(content: string, column: number): number {
    if (!content) return 4;
    const start = Math.max(0, column - 1);
    const tail = content.slice(start);
    if (tail.length === 0) return 4;

    const quoted = tail.match(/^"[^"]*"?|^'[^']*'?|^`[^`]*`?/);
    if (quoted?.[0]) {
        return Math.max(4, quoted[0].length);
    }
    const token = tail.match(/^[A-Za-z0-9_.$-]+/);
    if (token?.[0]) {
        return Math.max(4, token[0].length);
    }
    return Math.max(4, Math.min(12, tail.trimStart().length || 4));
}

function renderCodeFrame(location: DiagnosticLocation, contextRadius = 2): string[] {
    if (!location.path || !location.line || !location.column) return [];
    if (!fs.existsSync(location.path) || !fs.statSync(location.path).isFile()) return [];

    const raw = fs.readFileSync(location.path, "utf-8").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    if (location.line < 1 || location.line > lines.length) return [];

    const startLine = Math.max(1, location.line - contextRadius);
    const endLine = Math.min(lines.length, location.line + contextRadius);
    const gutterWidth = String(endLine).length;
    const out: string[] = [];

    for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
        const marker = lineNo === location.line ? ">" : " ";
        const content = lines[lineNo - 1] ?? "";
        out.push(`${marker} ${String(lineNo).padStart(gutterWidth, " ")} | ${content}`);
        if (lineNo === location.line) {
            const safeColumn = Math.max(1, location.column);
            const underlineWidth = estimateUnderlineWidth(content, safeColumn);
            const underlinePadding = " ".repeat(gutterWidth + 5 + safeColumn - 1);
            out.push(`${" ".repeat(2)}${underlinePadding}${"~".repeat(underlineWidth)}`);
        }
    }

    return out;
}

function describeMissingCodeFrame(location: DiagnosticLocation): string | undefined {
    if (!location.path) {
        return "未能提取到源码文件位置，因此无法显示代码切片。";
    }
    if (!location.line || !location.column) {
        return "已定位到源码文件，但未能提取到具体行列，因此无法显示代码切片。";
    }
    if (!fs.existsSync(location.path) || !fs.statSync(location.path).isFile()) {
        return "已定位到源码文件路径，但当前无法读取该文件，因此无法显示代码切片。";
    }
    return undefined;
}

export function countDiagnosticItems(diagnostics: AnalyzeErrorDiagnostics): number {
    return normalizeDiagnosticsItems(diagnostics).length;
}

export function formatDiagnosticsText(
    diagnostics: AnalyzeErrorDiagnostics,
    options: DiagnosticsRenderOptions = {},
): string {
    const items = normalizeDiagnosticsItems(diagnostics);
    const maxItems = options.maxItems && options.maxItems > 0
        ? Math.min(options.maxItems, items.length)
        : items.length;
    const visibleItems = items.slice(0, maxItems);
    if (items.length === 0) {
        return "ArkTaint diagnostics\n\nNo rule/pack/plugin/system errors were recorded.\n";
    }

    const lines: string[] = [];
    if (options.includeHeader !== false) {
        lines.push("ArkTaint diagnostics");
        lines.push("");
    }
    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        lines.push(`${i + 1}. [${categoryLabel(item.category)}] ${item.title}`);
        lines.push(`   错误码：${item.code}`);
        lines.push(`   问题：${item.summary}`);
        lines.push(`   位置：${toLocation(item)}`);
        lines.push(`   说明：${item.rawMessage}`);
        if (item.fieldPath) {
            lines.push(`   字段：${item.fieldPath}`);
        }
        lines.push(`   建议：${item.advice}`);
        const frame = renderCodeFrame(item);
        if (frame.length > 0) {
            lines.push("");
            for (const line of frame) {
                lines.push(`   ${line}`);
            }
        } else {
            const frameNote = describeMissingCodeFrame(item);
            if (frameNote) {
                lines.push(`   切片：${frameNote}`);
            }
        }
        if (i !== visibleItems.length - 1) {
            lines.push("");
        }
    }
    if (items.length > visibleItems.length) {
        lines.push("");
        lines.push(`... 还有 ${items.length - visibleItems.length} 条诊断，请查看完整 diagnostics.txt。`);
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
}

export function writeDiagnosticsArtifacts(
    outputDir: string,
    diagnostics: AnalyzeErrorDiagnostics,
): DiagnosticsArtifactPaths {
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.resolve(outputDir, "diagnostics.json");
    const textPath = path.resolve(outputDir, "diagnostics.txt");
    const items = normalizeDiagnosticsItems(diagnostics);
    const payload: DiagnosticsJsonArtifact = {
        schemaVersion: "1.0",
        itemCount: items.length,
        items,
        rawDiagnostics: diagnostics,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.writeFileSync(textPath, formatDiagnosticsText(diagnostics), "utf-8");
    return { jsonPath, textPath };
}
