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
        summary: options.summary || "The main analysis flow threw an uncategorized error.",
        advice: options.advice || "Inspect the nearby code and stack frame to determine whether the issue comes from configuration, an extension module, or the engine mainline.",
        title: options.title || "Analysis Main Flow",
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
            return "Rule";
        case "Module":
            return "Module";
        case "Plugin":
            return "Plugin";
        case "System":
            return "System";
    }
}

function normalizeCodeFragment(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
}

function classifyLegacyLoadMessage(prefix: "MODULE" | "PLUGIN", message: string): { code: string; advice: string } {
    const lower = message.toLowerCase();
    if (lower.includes("cannot find module")) {
        return {
            code: `${prefix}_LOAD_MODULE_NOT_FOUND`,
            advice: "Check the import/require path and confirm that the referenced file exists.",
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
            code: `${prefix}_LOAD_SYNTAX_ERROR`,
            advice: "Check the nearby syntax, especially brackets, commas, string literals, and import/export syntax.",
        };
    }
    if (lower.includes("is not a function")) {
        return {
            code: `${prefix}_LOAD_BAD_EXPORT`,
            advice: "Check whether the exported object is a valid module/plugin definition and whether the intended export is actually exported.",
        };
    }
    return {
        code: `${prefix}_LOAD_UNKNOWN`,
        advice: "Inspect the module file and its imports directly; the loader could not classify the failure more precisely.",
    };
}

function fallbackModuleRuntimeAdvice(phase: string): { code: string; advice: string } {
    return {
        code: `MODULE_${normalizeCodeFragment(phase)}_THROW`,
        advice: "This module threw directly from one of its runtime hooks. Check nearby code, null handling, and helper return values.",
    };
}

function fallbackPluginRuntimeAdvice(phase: string): { code: string; advice: string } {
    return {
        code: `PLUGIN_${normalizeCodeFragment(phase)}_THROW`,
        advice: "This plugin threw directly from one of its runtime hooks. Check nearby code, null handling, and helper return values.",
    };
}

function describeRuleKind(issue: AnalyzeErrorDiagnostics["ruleLoadIssues"][number]): { code: string; summary: string; advice: string } {
    switch (issue.kind) {
        case "file_missing":
            return {
                code: "RULE_FILE_MISSING",
                summary: "Rule file missing",
                advice: "Check the configured path or confirm that the rule file has been generated.",
            };
        case "json_parse":
            return {
                code: "RULE_JSON_PARSE",
                summary: "Rule JSON parse error",
                advice: "Check nearby JSON syntax, especially commas and closing brackets/braces.",
            };
        case "schema_assert":
            return {
                code: "RULE_SCHEMA_INVALID",
                summary: "Rule schema assertion failed",
                advice: "Check whether the failing field shape matches the supported rule schema.",
            };
        case "validation":
            return {
                code: "RULE_FIELD_INVALID",
                summary: "Rule field validation failed",
                advice: "Check the field type and allowed value range for the reported rule field.",
            };
        case "merged_validation":
            return {
                code: "RULE_MERGED_INVALID",
                summary: "Merged rule set invalid",
                advice: "Check whether multiple rule files produce an invalid merged inventory or conflicting fields.",
            };
    }
}

function describeModulePhase(phase: string): string {
    switch (phase) {
        case "setup":
            return "setup";
        case "onFact":
            return "onFact";
        case "onInvoke":
            return "onInvoke";
        case "shouldSkipCopyEdge":
            return "shouldSkipCopyEdge";
        case "module_load":
            return "module_load";
        default:
            return phase;
    }
}

function describePluginPhase(phase: string): string {
    const map: Record<string, string> = {
        onStart: "onStart",
        onEntry: "onEntry",
        onPropagation: "onPropagation",
        onDetection: "onDetection",
        onResult: "onResult",
        onFinish: "onFinish",
        "result.filter": "result.filter",
        "result.transform": "result.transform",
        "propagation.observer": "propagation.observer",
        module_load: "module_load",
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
            title: `${issue.layerName} Rules`,
            summary: desc.summary,
            rawMessage: issue.message,
            advice: desc.advice,
            path: issue.path,
            line: issue.line,
            column: issue.column,
            fieldPath: issue.fieldPath,
        });
    }
    for (const issue of diagnostics.moduleLoadIssues) {
        const load = issue.code && issue.advice
            ? { code: issue.code, advice: issue.advice }
            : classifyLegacyLoadMessage("MODULE", issue.message);
        out.push({
            category: "Module",
            code: load.code,
            title: "Module Load",
            summary: "Module load failed",
            rawMessage: issue.message,
            advice: load.advice,
            path: issue.modulePath,
            line: issue.line,
            column: issue.column,
        });
    }
    for (const failure of diagnostics.moduleRuntimeFailures) {
        const phaseLabel = describeModulePhase(failure.phase);
        const runtime = failure.code && failure.advice
            ? { code: failure.code, advice: failure.advice }
            : fallbackModuleRuntimeAdvice(failure.phase);
        out.push({
            category: "Module",
            code: runtime.code,
            title: `${failure.moduleId} / ${phaseLabel}`,
            summary: `Module ${failure.moduleId} threw during ${phaseLabel}`,
            rawMessage: failure.message,
            advice: runtime.advice,
            path: failure.path,
            line: failure.line,
            column: failure.column,
            stackExcerpt: failure.stackExcerpt,
        });
    }
    for (const issue of diagnostics.enginePluginLoadIssues) {
        const load = issue.code && issue.advice
            ? { code: issue.code, advice: issue.advice }
            : classifyLegacyLoadMessage("PLUGIN", issue.message);
        out.push({
            category: "Plugin",
            code: load.code,
            title: "Plugin Load",
            summary: "Plugin load failed",
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
            summary: `Plugin ${failure.pluginName} threw during ${phaseLabel}`,
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
            title: failure.title || "Analysis Main Flow",
            summary: failure.summary || "The main analysis flow threw an uncategorized error.",
            rawMessage: failure.message,
            advice: failure.advice || "Inspect the nearby code and stack frame to identify whether the issue belongs to configuration, a rule/module/plugin, or the engine mainline.",
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
        return "No source file location is available, so no code frame can be shown.";
    }
    if (!location.line || !location.column) {
        return "A source file is known, but no precise line/column was available for a code frame.";
    }
    if (!fs.existsSync(location.path) || !fs.statSync(location.path).isFile()) {
        return "The source file path is known, but the file is not currently readable.";
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
        return "ArkTaint diagnostics\n\nNo rule/module/plugin/system errors were recorded.\n";
    }

    const lines: string[] = [];
    if (options.includeHeader !== false) {
        lines.push("ArkTaint diagnostics");
        lines.push("");
    }
    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        lines.push(`${i + 1}. [${categoryLabel(item.category)}] ${item.title}`);
        lines.push(`   code: ${item.code}`);
        lines.push(`   summary: ${item.summary}`);
        lines.push(`   location: ${toLocation(item)}`);
        lines.push(`   message: ${item.rawMessage}`);
        if (item.fieldPath) {
            lines.push(`   field: ${item.fieldPath}`);
        }
        if (item.stackExcerpt) {
            lines.push(`   stack: ${item.stackExcerpt}`);
        }
        lines.push(`   advice: ${item.advice}`);
        const frame = renderCodeFrame(item);
        if (frame.length > 0) {
            lines.push("");
            for (const line of frame) {
                lines.push(`   ${line}`);
            }
        } else {
            const frameNote = describeMissingCodeFrame(item);
            if (frameNote) {
                lines.push(`   codeFrame: ${frameNote}`);
            }
        }
        if (i !== visibleItems.length - 1) {
            lines.push("");
        }
    }
    if (items.length > visibleItems.length) {
        lines.push("");
        lines.push(`... ${items.length - visibleItems.length} more diagnostics are available in diagnostics.txt.`);
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
