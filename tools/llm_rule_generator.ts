/**
 * LLM Rule Generator
 * 
 * 从 summary.json 读取分析结果，构建 hotspots，调用 LLM 生成规则，输出 llm_candidate.rules.json
 * 
 * Usage:
 *   npx ts-node tools/llm_rule_generator.ts <summary.json> [output.rules.json]
 *   node out/tools/llm_rule_generator.js <summary.json> [output.rules.json]
 * 
 * Environment Variables:
 *   LLM_API_KEY       - API Key for LLM service
 *   LLM_API_URL       - API endpoint URL (default: OpenAI compatible)
 *   LLM_MODEL         - Model name (default: gpt-4o-mini)
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

interface RuleInvokeKind {
    kind: "any" | "instance" | "static";
}

interface NoCandidateCallsite {
    callee_signature: string;
    method: string;
    invokeKind: "any" | "instance" | "static";
    argCount: number;
    sourceFile: string;
    count: number;
    topEntries?: string[];
}

interface UncoveredInvoke {
    signature: string;
    methodName: string;
    count: number;
    sourceDir: string;
    invokeKind: "any" | "instance" | "static";
    argCount: number;
}

interface RuleFeedback {
    zeroHitRules?: any;
    ruleHitRanking?: any;
    uncoveredHighFrequencyInvokes?: UncoveredInvoke[];
    noCandidateCallsites?: NoCandidateCallsite[];
}

interface AnalyzeSummary {
    generatedAt: string;
    repo: string;
    sourceDirs: string[];
    profile: string;
    ruleLayers: string[];
    summary: {
        ruleFeedback?: RuleFeedback;
        [key: string]: any;
    };
}

interface DataflowHint {
    from: string;
    to: string;
}

interface Hotspot {
    id: string;
    reason: string;
    functionSignature: string;
    callsiteSignature?: string;
    file: string;
    method: string;
    snippet?: string;
    dataflowHint?: DataflowHint;
    invokeKind?: string;
    argCount?: number;
}

interface LLMRequest {
    contractVersion: string;
    project: {
        name: string;
        repoPath: string;
        sourceDirs: string[];
        ruleLayers: string[];
    };
    constraints: {
        topN: number;
        allowedKinds: string[];
        forbidFrameworkDuplicate: boolean;
        maxRulesPerHotspot: number;
    };
    hotspots: Hotspot[];
}

interface LLMDecision {
    hotspotId: string;
    action: "emit_rule" | "skip_framework_covered" | "insufficient_context";
    ruleKind?: "source" | "sink" | "transfer" | "sanitizer";
    confidence?: number;
    rationale?: string;
    rule?: any;
}

interface LLMResponse {
    contractVersion: string;
    decisions: LLMDecision[];
}

interface TaintRuleSet {
    schemaVersion: string;
    meta?: {
        name?: string;
        description?: string;
        updatedAt?: string;
    };
    sources: any[];
    sinks: any[];
    sanitizers?: any[];
    transfers: any[];
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    contractVersion: "1.0",
    defaultModel: "gpt-4o-mini",
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    maxHotspots: 30,
    temperature: 0.3,
    maxTokens: 16384,
};

// ============================================================================
// Hotspot Builder
// ============================================================================

function inferDataflowHint(item: NoCandidateCallsite | UncoveredInvoke): DataflowHint {
    const method = ("method" in item ? item.method : item.methodName) || "";
    const nameLower = method.toLowerCase();
    const invokeKind = item.invokeKind;
    const argCount = item.argCount;

    if (nameLower.includes("set") || nameLower.includes("put") || nameLower.includes("push") || nameLower.includes("add")) {
        return { from: "arg0", to: "base" };
    }
    if (nameLower.includes("get") || nameLower.includes("fetch") || nameLower.includes("query") || nameLower.includes("load")) {
        if (argCount >= 1) {
            return { from: "arg0", to: "result" };
        }
        return { from: "base", to: "result" };
    }
    if (nameLower.includes("insert") || nameLower.includes("update") || nameLower.includes("save") || nameLower.includes("write")) {
        return { from: "arg0", to: "base" };
    }
    if (argCount >= 1) {
        return { from: "arg0", to: "result" };
    }
    if (invokeKind === "instance") {
        return { from: "base", to: "result" };
    }
    return { from: "arg0", to: "result" };
}

function inferReasonForUncovered(item: UncoveredInvoke): string {
    const nameLower = item.methodName.toLowerCase();
    const sigLower = item.signature.toLowerCase();

    if (sigLower.includes("@ohos") || sigLower.includes("@system")) {
        return "unknown_external_function";
    }
    if (nameLower.includes("get") || nameLower.includes("fetch") || nameLower.includes("load") || nameLower.includes("read")) {
        return "unknown_external_function";
    }
    if (nameLower.includes("set") || nameLower.includes("put") || nameLower.includes("save") || nameLower.includes("insert") || nameLower.includes("write")) {
        return "no_sink_match_on_tainted_path";
    }
    return "unknown_external_function";
}

function extractFileFromSignature(signature: string): string {
    const match = signature.match(/@([^:]+\.ets):/);
    if (match) return match[1];
    const match2 = signature.match(/@([^:]+):/);
    if (match2) return match2[1];
    return "";
}

function extractMethodFromSignature(signature: string): string {
    const match = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return match ? match[1] : "";
}

function extractClassFromSignature(signature: string): string {
    const match = signature.match(/:\s*([A-Za-z0-9_$]+)\./);
    return match ? match[1] : "";
}

function buildHotspotsFromSummary(summary: AnalyzeSummary): Hotspot[] {
    const hotspots: Hotspot[] = [];
    const rf = summary.summary?.ruleFeedback;
    if (!rf) return hotspots;

    let idCounter = 1;

    const noCandidates = rf.noCandidateCallsites || [];
    for (const item of noCandidates.slice(0, CONFIG.maxHotspots)) {
        const dataflowHint = inferDataflowHint(item);
        hotspots.push({
            id: `hs_transfer_${String(idCounter++).padStart(3, "0")}`,
            reason: "no_candidate_rule_for_callsite",
            functionSignature: item.callee_signature,
            file: item.sourceFile || extractFileFromSignature(item.callee_signature),
            method: item.method,
            invokeKind: item.invokeKind,
            argCount: item.argCount,
            dataflowHint,
        });
    }

    const uncovered = rf.uncoveredHighFrequencyInvokes || [];
    const remainingSlots = CONFIG.maxHotspots - hotspots.length;
    for (const item of uncovered.slice(0, remainingSlots)) {
        const reason = inferReasonForUncovered(item);
        hotspots.push({
            id: `hs_uncovered_${String(idCounter++).padStart(3, "0")}`,
            reason,
            functionSignature: item.signature,
            file: extractFileFromSignature(item.signature),
            method: item.methodName,
            invokeKind: item.invokeKind,
            argCount: item.argCount,
            dataflowHint: inferDataflowHint(item),
        });
    }

    return hotspots;
}

// ============================================================================
// Prompt Builder
// ============================================================================

function loadFewShotExamples(): any[] {
    const candidates = [
        path.resolve(__dirname, "../docs/llm_fewshot_wanharmony.json"),
        path.resolve(process.cwd(), "docs/llm_fewshot_wanharmony.json"),
    ];
    
    for (const fewShotPath of candidates) {
        if (fs.existsSync(fewShotPath)) {
            try {
                const content = JSON.parse(fs.readFileSync(fewShotPath, "utf-8"));
                console.log(`Loaded few-shot examples from: ${fewShotPath}`);
                return content.examples || [];
            } catch (e) {
                console.warn(`Failed to parse few-shot file ${fewShotPath}: ${e}`);
            }
        }
    }
    
    console.warn("Few-shot file not found, proceeding without examples");
    return [];
}

function buildSystemPrompt(): string {
    return `你是一个专业的污点分析规则生成助手。你的任务是根据用户提供的卡点信息（hotspots），生成对应的污点分析规则。

## 规则类型
1. **source**: 污点源规则，标记数据来源
2. **sink**: 污点汇规则，标记敏感操作
3. **transfer**: 污点传播规则，描述数据流动
4. **sanitizer**: 净化规则，标记消毒函数

## 卡点原因到规则类型映射
- no_candidate_rule_for_callsite → 优先输出 transfer
- no_transfer → 优先输出 transfer  
- unknown_external_function → 输出 source 或 sink
- no_sink_match_on_tainted_path → 优先输出 sink
- flow_found_on_path_without_guard → 优先输出 sanitizer

## 规则字段要求
- source: 必须包含 match + targetRef.endpoint
- sink: 必须包含 match + sinkTargetRef.endpoint
- transfer: 必须包含 match + from + to
- sanitizer: 必须包含 match + sanitizeTargetRef.endpoint

## 输出格式
严格按照 JSON 格式输出，只包含 decisions 数组。每个 decision 包含:
- hotspotId: 对应的卡点 ID
- action: "emit_rule" | "skip_framework_covered" | "insufficient_context"
- ruleKind: "source" | "sink" | "transfer" | "sanitizer"
- confidence: 0-1 之间的置信度
- rationale: 简短的理由说明
- rule: 生成的规则对象 (action 为 emit_rule 时必须)

## 重要约束
1. 所有生成的规则 enabled 必须为 false
2. 规则 ID 格式: {ruleKind}.llm.{project}.{feature}.{detail}
3. 优先使用 signature_contains 或 method_name_equals 作为 match.kind
4. 使用 scope 收窄匹配范围，避免误匹配`;
}

function buildUserPrompt(request: LLMRequest, fewShotExamples: any[]): string {
    const fewShotText = fewShotExamples.length > 0
        ? `## Few-shot 示例\n\`\`\`json\n${JSON.stringify(fewShotExamples.slice(0, 3), null, 2)}\n\`\`\`\n\n`
        : "";

    return `${fewShotText}## 当前请求

请为以下 hotspots 生成规则:

\`\`\`json
${JSON.stringify(request, null, 2)}
\`\`\`

请严格按照输出协议返回 JSON，格式如下:
\`\`\`json
{
  "contractVersion": "1.0",
  "decisions": [...]
}
\`\`\``;
}

// ============================================================================
// LLM API Caller
// ============================================================================

async function callLLMApi(systemPrompt: string, userPrompt: string): Promise<string> {
    const apiKey = process.env.LLM_API_KEY;
    const apiUrl = process.env.LLM_API_URL || CONFIG.defaultApiUrl;
    const model = process.env.LLM_MODEL || CONFIG.defaultModel;

    if (!apiKey) {
        throw new Error("LLM_API_KEY environment variable is required");
    }

    const requestBody = {
        model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        temperature: CONFIG.temperature,
        max_tokens: CONFIG.maxTokens,
    };

    console.log(`Calling LLM API: ${apiUrl}`);
    console.log(`Model: ${model}`);

    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = await response.json() as any;
    
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
        console.warn(`[WARN] Response was truncated (finish_reason: length). Consider reducing hotspots or increasing maxTokens.`);
    }
    
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error("No content in LLM response");
    }

    return content;
}

// ============================================================================
// Response Parser
// ============================================================================

function extractJsonFromResponse(rawResponse: string): LLMResponse {
    let content = rawResponse.trim();

    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
        content = jsonBlockMatch[1].trim();
    }

    const jsonStartIndex = content.indexOf("{");
    const jsonEndIndex = content.lastIndexOf("}");
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        content = content.slice(jsonStartIndex, jsonEndIndex + 1);
    }

    try {
        const parsed = JSON.parse(content);
        if (!parsed.decisions) {
            if (Array.isArray(parsed)) {
                return { contractVersion: CONFIG.contractVersion, decisions: parsed };
            }
            throw new Error("No 'decisions' field in response");
        }
        return parsed as LLMResponse;
    } catch (e) {
        console.error("Failed to parse LLM response:");
        console.error(content.slice(0, 500));
        throw new Error(`JSON parse error: ${e}`);
    }
}

// ============================================================================
// Rule Set Generator
// ============================================================================

function sanitizeRuleId(rawId: string): string {
    return rawId
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

function convertDecisionsToRuleSet(decisions: LLMDecision[], projectName: string): TaintRuleSet {
    const sources: any[] = [];
    const sinks: any[] = [];
    const sanitizers: any[] = [];
    const transfers: any[] = [];

    for (const decision of decisions) {
        if (decision.action !== "emit_rule" || !decision.rule) {
            continue;
        }

        const rule = { ...decision.rule };

        if (!rule.id) {
            rule.id = `${decision.ruleKind || "unknown"}.llm.${projectName}.${decision.hotspotId}`;
        }
        rule.id = sanitizeRuleId(rule.id);

        rule.enabled = false;

        if (!rule.tags) {
            rule.tags = [];
        }
        if (!rule.tags.includes("llm_generated")) {
            rule.tags.push("llm_generated");
        }

        rule.description = rule.description || decision.rationale || "";

        switch (decision.ruleKind) {
            case "source":
                sources.push(rule);
                break;
            case "sink":
                sinks.push(rule);
                break;
            case "sanitizer":
                sanitizers.push(rule);
                break;
            case "transfer":
                transfers.push(rule);
                break;
            default:
                console.warn(`Unknown rule kind: ${decision.ruleKind}`);
        }
    }

    return {
        schemaVersion: "1.1",
        meta: {
            name: "LLM Generated Rules",
            description: `Auto-generated candidate rules by LLM for ${projectName}. All rules are disabled by default and require manual review.`,
            updatedAt: new Date().toISOString(),
        },
        sources,
        sinks,
        sanitizers,
        transfers,
    };
}

// ============================================================================
// Mock LLM (for testing without API)
// ============================================================================

function mockLLMResponse(hotspots: Hotspot[]): LLMResponse {
    const decisions: LLMDecision[] = [];

    for (const hotspot of hotspots) {
        const className = extractClassFromSignature(hotspot.functionSignature);
        const methodName = hotspot.method || extractMethodFromSignature(hotspot.functionSignature);

        if (hotspot.reason === "no_candidate_rule_for_callsite") {
            const from = hotspot.dataflowHint?.from || "arg0";
            const to = hotspot.dataflowHint?.to || "result";
            decisions.push({
                hotspotId: hotspot.id,
                action: "emit_rule",
                ruleKind: "transfer",
                confidence: 0.75,
                rationale: `Auto-generated transfer rule for ${methodName}: ${from} -> ${to}`,
                rule: {
                    id: `transfer.llm.auto.${className}.${methodName}.${from}_to_${to}`.toLowerCase(),
                    enabled: false,
                    match: {
                        kind: "method_name_equals",
                        value: methodName,
                    },
                    scope: className ? {
                        className: {
                            mode: "equals",
                            value: className,
                        },
                    } : undefined,
                    from,
                    to,
                },
            });
        } else if (hotspot.reason === "unknown_external_function") {
            decisions.push({
                hotspotId: hotspot.id,
                action: "emit_rule",
                ruleKind: "source",
                confidence: 0.6,
                rationale: `Potential source from external function ${methodName}`,
                rule: {
                    id: `source.llm.auto.${className}.${methodName}.call_return`.toLowerCase(),
                    enabled: false,
                    kind: "call_return",
                    match: {
                        kind: "method_name_equals",
                        value: methodName,
                    },
                    scope: className ? {
                        className: {
                            mode: "equals",
                            value: className,
                        },
                    } : undefined,
                    targetRef: {
                        endpoint: "result",
                    },
                },
            });
        } else if (hotspot.reason === "no_sink_match_on_tainted_path") {
            decisions.push({
                hotspotId: hotspot.id,
                action: "emit_rule",
                ruleKind: "sink",
                confidence: 0.7,
                rationale: `Potential sink at ${methodName}`,
                rule: {
                    id: `sink.llm.auto.${className}.${methodName}.arg0`.toLowerCase(),
                    enabled: false,
                    severity: "medium",
                    match: {
                        kind: "method_name_equals",
                        value: methodName,
                    },
                    scope: className ? {
                        className: {
                            mode: "equals",
                            value: className,
                        },
                    } : undefined,
                    sinkTargetRef: {
                        endpoint: hotspot.argCount && hotspot.argCount > 0 ? "arg0" : "base",
                    },
                },
            });
        } else {
            decisions.push({
                hotspotId: hotspot.id,
                action: "insufficient_context",
                ruleKind: "transfer",
                confidence: 0.3,
                rationale: "Not enough context to generate rule",
            });
        }
    }

    return {
        contractVersion: CONFIG.contractVersion,
        decisions,
    };
}

// ============================================================================
// Main
// ============================================================================

interface CliOptions {
    summaryPath: string;
    outputPath: string;
    useMock: boolean;
    dryRun: boolean;
    verbose: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    let summaryPath = "";
    let outputPath = "";
    let useMock = false;
    let dryRun = false;
    let verbose = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--mock") {
            useMock = true;
        } else if (arg === "--dry-run") {
            dryRun = true;
        } else if (arg === "--verbose" || arg === "-v") {
            verbose = true;
        } else if (arg === "--output" || arg === "-o") {
            outputPath = argv[++i] || "";
        } else if (!arg.startsWith("-")) {
            if (!summaryPath) {
                summaryPath = arg;
            } else if (!outputPath) {
                outputPath = arg;
            }
        }
    }

    if (!summaryPath) {
        console.error("Usage: llm_rule_generator.ts <summary.json> [output.rules.json]");
        console.error("");
        console.error("Options:");
        console.error("  --mock       Use mock LLM instead of real API");
        console.error("  --dry-run    Build hotspots but don't call LLM");
        console.error("  --verbose    Show detailed output");
        console.error("  -o, --output Specify output file path");
        console.error("");
        console.error("Environment Variables:");
        console.error("  LLM_API_KEY  API key for LLM service (required unless --mock)");
        console.error("  LLM_API_URL  API endpoint (default: OpenAI)");
        console.error("  LLM_MODEL    Model name (default: gpt-4o-mini)");
        process.exit(1);
    }

    if (!outputPath) {
        outputPath = path.resolve(path.dirname(summaryPath), "../rules/llm_candidate.rules.json");
    }

    return { summaryPath, outputPath, useMock, dryRun, verbose };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));

    console.log("====== LLM Rule Generator ======");
    console.log(`Summary: ${options.summaryPath}`);
    console.log(`Output: ${options.outputPath}`);
    console.log(`Mode: ${options.useMock ? "MOCK" : "API"}`);

    if (!fs.existsSync(options.summaryPath)) {
        throw new Error(`Summary file not found: ${options.summaryPath}`);
    }

    const summary: AnalyzeSummary = JSON.parse(fs.readFileSync(options.summaryPath, "utf-8"));
    const projectName = path.basename(summary.repo) || "project";

    console.log(`\nProject: ${projectName}`);
    console.log(`Repo: ${summary.repo}`);
    console.log(`Source dirs: ${summary.sourceDirs.join(", ")}`);

    const hotspots = buildHotspotsFromSummary(summary);
    console.log(`\nHotspots found: ${hotspots.length}`);

    if (hotspots.length === 0) {
        console.log("No hotspots to process. Exiting.");
        return;
    }

    if (options.verbose) {
        console.log("\nHotspots:");
        for (const hs of hotspots) {
            console.log(`  ${hs.id}: ${hs.reason} - ${hs.method} (${hs.functionSignature.slice(0, 60)}...)`);
        }
    }

    const request: LLMRequest = {
        contractVersion: CONFIG.contractVersion,
        project: {
            name: projectName,
            repoPath: summary.repo,
            sourceDirs: summary.sourceDirs,
            ruleLayers: summary.ruleLayers || ["default", "framework"],
        },
        constraints: {
            topN: CONFIG.maxHotspots,
            allowedKinds: ["source", "sink", "transfer", "sanitizer"],
            forbidFrameworkDuplicate: true,
            maxRulesPerHotspot: 2,
        },
        hotspots,
    };

    if (options.dryRun) {
        console.log("\n[Dry Run] LLM Request:");
        console.log(JSON.stringify(request, null, 2));
        return;
    }

    let llmResponse: LLMResponse;

    if (options.useMock) {
        console.log("\nUsing mock LLM...");
        llmResponse = mockLLMResponse(hotspots);
    } else {
        console.log("\nCalling LLM API...");
        const fewShotExamples = loadFewShotExamples();
        const systemPrompt = buildSystemPrompt();
        const userPrompt = buildUserPrompt(request, fewShotExamples);

        if (options.verbose) {
            console.log("\n--- System Prompt ---");
            console.log(systemPrompt.slice(0, 500) + "...");
            console.log("\n--- User Prompt ---");
            console.log(userPrompt.slice(0, 500) + "...");
        }

        const rawResponse = await callLLMApi(systemPrompt, userPrompt);
        if (options.verbose) {
            console.log("\n--- Raw Response ---");
            console.log(rawResponse.slice(0, 1000) + "...");
        }
        llmResponse = extractJsonFromResponse(rawResponse);
    }

    console.log(`\nDecisions received: ${llmResponse.decisions.length}`);

    const emittedCount = llmResponse.decisions.filter(d => d.action === "emit_rule").length;
    const skippedCount = llmResponse.decisions.filter(d => d.action === "skip_framework_covered").length;
    const insufficientCount = llmResponse.decisions.filter(d => d.action === "insufficient_context").length;

    console.log(`  - emit_rule: ${emittedCount}`);
    console.log(`  - skip_framework_covered: ${skippedCount}`);
    console.log(`  - insufficient_context: ${insufficientCount}`);

    const ruleSet = convertDecisionsToRuleSet(llmResponse.decisions, projectName);

    console.log(`\nGenerated rules:`);
    console.log(`  - sources: ${ruleSet.sources.length}`);
    console.log(`  - sinks: ${ruleSet.sinks.length}`);
    console.log(`  - transfers: ${ruleSet.transfers.length}`);
    console.log(`  - sanitizers: ${ruleSet.sanitizers?.length || 0}`);

    const outputDir = path.dirname(options.outputPath);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(options.outputPath, JSON.stringify(ruleSet, null, 2) + "\n", "utf-8");

    console.log(`\nOutput written to: ${options.outputPath}`);

    const reportPath = options.outputPath.replace(/\.json$/, ".report.json");
    const report = {
        generatedAt: new Date().toISOString(),
        summaryPath: options.summaryPath,
        outputPath: options.outputPath,
        projectName,
        hotspotsCount: hotspots.length,
        decisionsCount: llmResponse.decisions.length,
        emittedRulesCount: emittedCount,
        ruleBreakdown: {
            sources: ruleSet.sources.length,
            sinks: ruleSet.sinks.length,
            transfers: ruleSet.transfers.length,
            sanitizers: ruleSet.sanitizers?.length || 0,
        },
        decisions: llmResponse.decisions,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
    console.log(`Report written to: ${reportPath}`);

    console.log("\n====== Done ======");
}

main().catch(err => {
    console.error("Error:", err.message || err);
    process.exit(1);
});
