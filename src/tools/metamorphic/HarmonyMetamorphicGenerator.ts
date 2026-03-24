import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export type HarmonyMutatorGroup = "A" | "B";

export interface HarmonyBenchRulePaths {
    default: string;
    framework: string;
    project: string;
}

export interface HarmonyBenchCase {
    case_id: string;
    file: string;
    entry: string;
    expected_flow: boolean;
    expected_sink_pattern: string;
    scored: boolean;
}

export interface HarmonyBenchCategory {
    id: string;
    name: string;
    supported: boolean;
    sourceDir: string;
    rules: HarmonyBenchRulePaths;
    cases: HarmonyBenchCase[];
}

export interface HarmonyBenchManifest {
    name: string;
    version: string;
    description?: string;
    categories: HarmonyBenchCategory[];
}

interface HarmonyRuleMatchShape {
    kind?: string;
    value?: unknown;
}

interface HarmonyRuleShape {
    match?: HarmonyRuleMatchShape;
}

interface HarmonyRuleFileShape {
    sources?: HarmonyRuleShape[];
    sinks?: HarmonyRuleShape[];
    transfers?: HarmonyRuleShape[];
}

export interface HarmonyAnchorProfile {
    sinkMethodNames: string[];
    sourceMethodNames: string[];
    transferMethodNames: string[];
}

export interface HarmonyTransformContext {
    caseInfo: HarmonyBenchCase;
    anchorProfile: HarmonyAnchorProfile;
    l2Hint?: HarmonySemanticAnchorHint;
}

export interface HarmonyTransformSpec {
    name: string;
    group: HarmonyMutatorGroup;
    description: string;
    supportsCase?: (ctx: HarmonyTransformContext) => boolean;
    apply: (source: string, ctx: HarmonyTransformContext) => { code: string; changed: boolean };
}

export interface HarmonyMutatedCase {
    group: HarmonyMutatorGroup;
    transform: string;
    categoryId: string;
    categoryName: string;
    sourceDirOriginal: string;
    sourceDirMutated: string;
    rulePaths: HarmonyBenchRulePaths;
    sourceCase: HarmonyBenchCase;
    mutatedFile: string;
}

export interface HarmonyMutationDataset {
    generatedAt: string;
    manifestPath: string;
    outputRoot: string;
    selectedCategoryIds: string[];
    maxCasesPerCategory: number;
    groups: HarmonyMutatorGroup[];
    totalCases: number;
    totalMutations: number;
    mutations: HarmonyMutatedCase[];
}

export interface HarmonyMutationOptions {
    manifestPath: string;
    outputRoot: string;
    groups: HarmonyMutatorGroup[];
    maxCasesPerCategory: number;
    categoryIdPattern: RegExp;
    semanticAnchorHintsPath?: string;
}

export interface HarmonySemanticAnchorHint {
    preferredMethodNames?: string[];
    preferredCalleeRegex?: string;
}

type HarmonySemanticAnchorHintsMap = Record<string, HarmonySemanticAnchorHint>;

interface AnchorCallStatement {
    stmtStart: number;
    stmtEnd: number;
    indent: string;
    calleeText: string;
    argText: string;
}

function caseKey(categoryId: string, caseId: string): string {
    return `${categoryId}:${caseId}`;
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function normalizeRelPath(p: string): string {
    return p.replace(/\\/g, "/");
}

function sanitizePathPart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function readManifest(manifestPath: string): HarmonyBenchManifest {
    const abs = path.resolve(manifestPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`HarmonyBench manifest not found: ${abs}`);
    }
    const raw = fs.readFileSync(abs, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as HarmonyBenchManifest;
    if (!parsed.categories || !Array.isArray(parsed.categories)) {
        throw new Error("Invalid HarmonyBench manifest: categories[] missing.");
    }
    return parsed;
}

function copyDirSync(src: string, dst: string): void {
    ensureDir(dst);
    fs.cpSync(src, dst, { recursive: true, force: true });
}

function appendHelper(source: string, helper: string): string {
    if (source.includes(helper.trim())) {
        return source;
    }
    return `${source.trimEnd()}\n\n${helper}\n`;
}

function parseSourceFile(source: string): ts.SourceFile {
    return ts.createSourceFile("mutation.ets", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function getIndentForPos(source: string, pos: number): string {
    const lineStart = source.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
    const line = source.slice(lineStart, pos);
    const m = /^[ \t]*/.exec(line);
    return m ? m[0] : "";
}

function getCalleeMethodName(expr: ts.LeftHandSideExpression): string | null {
    if (ts.isIdentifier(expr)) {
        return expr.text;
    }
    if (ts.isPropertyAccessExpression(expr)) {
        return expr.name.text;
    }
    if (ts.isElementAccessExpression(expr)) {
        const arg = expr.argumentExpression;
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
            return arg.text;
        }
    }
    return null;
}

function parseExpectedSinkPatternMethodHints(pattern: string): string[] {
    if (!pattern || pattern.trim().length === 0) return [];
    const out = new Set<string>();
    let plain = pattern.trim();
    if (plain.startsWith("/") && plain.endsWith("/") && plain.length > 2) {
        plain = plain.slice(1, -1);
    }
    const regex = /([A-Za-z_]\w*)\s*(?:\\\(|\()/g;
    let m: RegExpExecArray | null = null;
    while ((m = regex.exec(plain)) !== null) {
        out.add(m[1]);
    }
    return [...out];
}

function readSemanticAnchorHints(filePath?: string): HarmonySemanticAnchorHintsMap {
    if (!filePath) return {};
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) return {};
    try {
        const raw = fs.readFileSync(abs, "utf-8").replace(/^\uFEFF/, "");
        const parsed = JSON.parse(raw) as HarmonySemanticAnchorHintsMap;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function findFirstAnchorCallStatement(
    source: string,
    methodNames: Set<string>,
    ctx: HarmonyTransformContext
): AnchorCallStatement | null {
    if (methodNames.size === 0) {
        return null;
    }
    const sf = parseSourceFile(source);
    const candidates: AnchorCallStatement[] = [];
    const expectedHints = new Set<string>(parseExpectedSinkPatternMethodHints(ctx.caseInfo.expected_sink_pattern || ""));
    const preferredMethods = new Set<string>((ctx.l2Hint?.preferredMethodNames || []).map(x => x.trim()).filter(Boolean));
    const preferredRegex = ctx.l2Hint?.preferredCalleeRegex ? new RegExp(ctx.l2Hint.preferredCalleeRegex) : null;

    const visit = (node: ts.Node): void => {
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
            const call = node.expression;
            const method = getCalleeMethodName(call.expression);
            if (method && methodNames.has(method) && call.arguments.length > 0) {
                candidates.push({
                    stmtStart: node.getStart(sf),
                    stmtEnd: node.getEnd(),
                    indent: getIndentForPos(source, node.getStart(sf)),
                    calleeText: call.expression.getText(sf),
                    argText: call.arguments[0].getText(sf),
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    if (candidates.length === 0) return null;

    const hintedCandidates = expectedHints.size > 0
        ? candidates.filter(c => {
            const method = c.calleeText.split(".").pop()?.replace(/["'\]\[]/g, "") || c.calleeText;
            return expectedHints.has(method);
        })
        : [];
    const pool = hintedCandidates.length > 0 ? hintedCandidates : candidates;

    const score = (c: AnchorCallStatement): number => {
        let s = 0;
        const method = c.calleeText.split(".").pop()?.replace(/["'\]\[]/g, "") || c.calleeText;
        if (preferredMethods.has(method)) s += 8;
        if (preferredRegex && preferredRegex.test(c.calleeText)) s += 6;
        if (expectedHints.has(method)) s += 4;
        if (c.calleeText.endsWith(".Sink") || c.calleeText === "Sink") s += 2;
        return s;
    };

    let best = pool[0];
    let bestScore = score(best);
    for (let i = 1; i < pool.length; i++) {
        const s = score(pool[i]);
        if (s > bestScore) {
            best = pool[i];
            bestScore = s;
        }
    }
    return best;
}

function replaceStatement(source: string, site: AnchorCallStatement, replacement: string): { code: string; changed: boolean } {
    const code = source.slice(0, site.stmtStart) + replacement + source.slice(site.stmtEnd);
    return { code, changed: code !== source };
}

function withSinkAnchorStatement(
    source: string,
    ctx: HarmonyTransformContext,
    replacer: (data: { expr: string; callee: string; indent: string }) => string
): { code: string; changed: boolean } {
    const names = new Set<string>(ctx.anchorProfile.sinkMethodNames);
    names.add("Sink");
    const site = findFirstAnchorCallStatement(source, names, ctx);
    if (!site) {
        return { code: source, changed: false };
    }
    const replacement = replacer({
        expr: site.argText,
        callee: site.calleeText,
        indent: site.indent,
    });
    return replaceStatement(source, site, replacement);
}

function findFirstSourceVarName(source: string, ctx: HarmonyTransformContext): string | null {
    const sourceNames = new Set<string>(ctx.anchorProfile.sourceMethodNames);
    sourceNames.add("taint_src");
    sourceNames.add("taint_src_meta");
    const sf = parseSourceFile(source);
    let found: string | null = null;

    const visit = (node: ts.Node): void => {
        if (found) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
            const method = getCalleeMethodName(node.initializer.expression);
            if (method && sourceNames.has(method)) {
                found = node.name.text;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return found;
}

function renameVariableAst(source: string, oldName: string, newName: string): { code: string; changed: boolean } {
    if (oldName === newName) {
        return { code: source, changed: false };
    }
    const sf = parseSourceFile(source);
    const spans: Array<{ start: number; end: number }> = [];
    const seen = new Set<string>();

    const shouldSkip = (node: ts.Identifier): boolean => {
        const p = node.parent;
        if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
        if (ts.isPropertyAssignment(p) && p.name === node) return true;
        if (ts.isShorthandPropertyAssignment(p)) return true;
        if (ts.isImportSpecifier(p)) return true;
        if (ts.isExportSpecifier(p)) return true;
        if (ts.isLiteralTypeNode(p)) return true;
        return false;
    };

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === oldName && !shouldSkip(node)) {
            const start = node.getStart(sf);
            const end = node.getEnd();
            const key = `${start}:${end}`;
            if (!seen.has(key)) {
                seen.add(key);
                spans.push({ start, end });
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);

    if (spans.length === 0) {
        return { code: source, changed: false };
    }
    spans.sort((a, b) => b.start - a.start);
    let code = source;
    for (const span of spans) {
        code = code.slice(0, span.start) + newName + code.slice(span.end);
    }
    return { code, changed: code !== source };
}

function collectMethodNameEquals(entries: HarmonyRuleShape[] | undefined): string[] {
    if (!entries || !Array.isArray(entries)) return [];
    const names: string[] = [];
    for (const e of entries) {
        const m = e?.match;
        if (!m || m.kind !== "method_name_equals") continue;
        if (typeof m.value === "string" && m.value.trim()) {
            names.push(m.value.trim());
        }
    }
    return names;
}

function readRuleFile(rulePath: string): HarmonyRuleFileShape {
    const abs = path.resolve(rulePath);
    if (!fs.existsSync(abs)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(abs, "utf-8").replace(/^\uFEFF/, "");
        return JSON.parse(raw) as HarmonyRuleFileShape;
    } catch {
        return {};
    }
}

function buildAnchorProfile(rulePaths: HarmonyBenchRulePaths): HarmonyAnchorProfile {
    const files = [
        readRuleFile(rulePaths.default),
        readRuleFile(rulePaths.framework),
        readRuleFile(rulePaths.project),
    ];
    const sinkSet = new Set<string>();
    const sourceSet = new Set<string>();
    const transferSet = new Set<string>();

    for (const f of files) {
        for (const name of collectMethodNameEquals(f.sinks)) sinkSet.add(name);
        for (const name of collectMethodNameEquals(f.sources)) sourceSet.add(name);
        for (const name of collectMethodNameEquals(f.transfers)) transferSet.add(name);
    }

    sinkSet.add("Sink");
    sourceSet.add("taint_src");
    sourceSet.add("taint_src_meta");

    return {
        sinkMethodNames: [...sinkSet],
        sourceMethodNames: [...sourceSet],
        transferMethodNames: [...transferSet],
    };
}

export const HARMONY_MUTATORS: HarmonyTransformSpec[] = [
    {
        name: "a_var_rename",
        group: "A",
        description: "Variables renaming around taint source locals (AST-based).",
        apply: (source, ctx) => {
            const name = findFirstSourceVarName(source, ctx);
            if (!name || name.startsWith("__mx_")) {
                return { code: source, changed: false };
            }
            return renameVariableAst(source, name, `__mx_${name}`);
        },
    },
    {
        name: "a_expr_split",
        group: "A",
        description: "Expression splitting via intermediate local.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_split = ${expr};\n${indent}${callee}(__mx_split);`
        ),
    },
    {
        name: "a_dead_code",
        group: "A",
        description: "Inject dead code before sink statement.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_dead = 1 + 1;\n${indent}${callee}(${expr});`
        ),
    },
    {
        name: "a_cf_rewrite",
        group: "A",
        description: "Equivalent if/else rewrite around sink.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_flag = true;\n`
                + `${indent}if (__mx_flag) {\n`
                + `${indent}  ${callee}(${expr});\n`
                + `${indent}} else {\n`
                + `${indent}  let __mx_else = 0;\n`
                + `${indent}}`
        ),
    },
    {
        name: "a_async_equiv",
        group: "A",
        description: "Equivalent async form via Promise.then.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_async = ${expr};\n`
                + `${indent}Promise.resolve(__mx_async).then(function(__mx_async_shadow) { return __mx_async_shadow; });\n`
                + `${indent}${callee}(__mx_async);`
        ),
    },
    {
        name: "b_state_driven",
        group: "B",
        description: "State-driven flow through object field.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_state = { value: ${expr} };\n${indent}${callee}(__mx_state.value);`
        ),
    },
    {
        name: "b_async_concurrency",
        group: "B",
        description: "Async/concurrency style via event loop callback.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_queue = ${expr};\n`
                + `${indent}setTimeout(function() { ${callee}(__mx_queue); }, 0);`
        ),
    },
    {
        name: "b_env_escape",
        group: "B",
        description: "Environment-based escape via global object relay.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}globalThis["__mx_escape"] = ${expr};\n${indent}${callee}(globalThis["__mx_escape"]);`
        ),
    },
    {
        name: "b_napi_boundary",
        group: "B",
        description: "Simulated NAPI boundary via black-box bridge wrapper.",
        apply: (source, ctx) => {
            const transformed = withSinkAnchorStatement(
                source,
                ctx,
                ({ expr, callee, indent }) => `${indent}let __mx_napi = __mx_napi_bridge(${expr});\n${indent}${callee}(__mx_napi);`
            );
            if (!transformed.changed) return transformed;
            const helper = "function __mx_napi_bridge(v: any): any { return v; }";
            return { code: appendHelper(transformed.code, helper), changed: true };
        },
    },
    {
        name: "b_higher_order_ds",
        group: "B",
        description: "Higher-order data structure relay through Map.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_map = new Map();\n`
                + `${indent}__mx_map.set("k", ${expr});\n`
                + `${indent}let __mx_out = __mx_map.get("k");\n`
                + `${indent}${callee}(__mx_out);`
        ),
    },
    {
        name: "b_dynamic_dispatch",
        group: "B",
        description: "Dynamic dispatch via Reflect.apply.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_dispatch = { sink: function(x: any) { ${callee}(x); } };\n`
                + `${indent}Reflect.apply(__mx_dispatch["sink"], undefined, [${expr}]);`
        ),
    },
    {
        name: "b_source_alias_relay",
        group: "B",
        description: "Source/transfer minimal set M1: alias relay before sink.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_alias_box = { value: ${expr} };\n`
                + `${indent}let __mx_alias_mid = __mx_alias_box.value;\n`
                + `${indent}${callee}(__mx_alias_mid);`
        ),
    },
    {
        name: "b_transfer_nonlinear",
        group: "B",
        description: "Source/transfer minimal set M2: nonlinear transfer before sink.",
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_transfer = ${expr};\n`
                + `${indent}let __mx_after;\n`
                + `${indent}if (__mx_transfer !== undefined) {\n`
                + `${indent}  __mx_after = __mx_transfer;\n`
                + `${indent}} else {\n`
                + `${indent}  __mx_after = __mx_transfer;\n`
                + `${indent}}\n`
                + `${indent}${callee}(__mx_after);`
        ),
    },
    {
        name: "b_higher_order_ds_safe_control",
        group: "B",
        description: "Safe-control case for over-tainting: tainted/safe key split.",
        supportsCase: (ctx) => !ctx.caseInfo.expected_flow,
        apply: (source, ctx) => withSinkAnchorStatement(
            source,
            ctx,
            ({ expr, callee, indent }) => `${indent}let __mx_map = new Map();\n`
                + `${indent}__mx_map.set("tainted_key", ${expr});\n`
                + `${indent}__mx_map.set("safe_key", "SAFE_VALUE");\n`
                + `${indent}let __mx_out = __mx_map.get("safe_key");\n`
                + `${indent}${callee}(__mx_out);`
        ),
    },
];

export function generateHarmonyMutationDataset(options: HarmonyMutationOptions): HarmonyMutationDataset {
    const manifestPath = path.resolve(options.manifestPath);
    const outputRoot = path.resolve(options.outputRoot);
    const manifest = readManifest(manifestPath);
    const selectedMutators = HARMONY_MUTATORS.filter(t => options.groups.includes(t.group));
    if (selectedMutators.length === 0) {
        throw new Error("No mutators selected. Please pass groups A and/or B.");
    }

    fs.rmSync(outputRoot, { recursive: true, force: true });
    ensureDir(outputRoot);

    const selectedCategories = manifest.categories.filter(c => options.categoryIdPattern.test(c.id));
    const semanticHints = readSemanticAnchorHints(options.semanticAnchorHintsPath);
    const mutations: HarmonyMutatedCase[] = [];

    for (const category of selectedCategories) {
        const sourceDirAbs = path.resolve(category.sourceDir);
        if (!fs.existsSync(sourceDirAbs)) {
            throw new Error(`Category sourceDir not found: ${sourceDirAbs}`);
        }
        const anchorProfile = buildAnchorProfile(category.rules);
        const categoryOutDir = path.join(outputRoot, sanitizePathPart(category.id));
        copyDirSync(sourceDirAbs, categoryOutDir);

        const scoredCases = category.cases.filter(c => c.scored);
        const selectedCases = options.maxCasesPerCategory > 0
            ? scoredCases.slice(0, options.maxCasesPerCategory)
            : scoredCases;

        for (const caseInfo of selectedCases) {
            const sourceAbs = path.join(sourceDirAbs, caseInfo.file);
            if (!fs.existsSync(sourceAbs)) {
                throw new Error(`Case file not found: ${sourceAbs}`);
            }
            const sourceCode = fs.readFileSync(sourceAbs, "utf-8");
            const dirRel = path.dirname(caseInfo.file);
            const base = path.basename(caseInfo.file, ".ets");
            const ctx: HarmonyTransformContext = {
                caseInfo,
                anchorProfile,
                l2Hint: semanticHints[caseKey(category.id, caseInfo.case_id)] || semanticHints[caseInfo.case_id],
            };

            for (const transform of selectedMutators) {
                if (transform.supportsCase && !transform.supportsCase(ctx)) {
                    continue;
                }
                const transformed = transform.apply(sourceCode, ctx);
                if (!transformed.changed) {
                    continue;
                }
                const mutatedFile = normalizeRelPath(path.join(dirRel, `${base}__mx_${transform.name}.ets`));
                const mutatedAbs = path.join(categoryOutDir, mutatedFile);
                ensureDir(path.dirname(mutatedAbs));
                fs.writeFileSync(mutatedAbs, transformed.code, "utf-8");
                mutations.push({
                    group: transform.group,
                    transform: transform.name,
                    categoryId: category.id,
                    categoryName: category.name,
                    sourceDirOriginal: sourceDirAbs,
                    sourceDirMutated: categoryOutDir,
                    rulePaths: category.rules,
                    sourceCase: caseInfo,
                    mutatedFile,
                });
            }
        }
    }

    const dataset: HarmonyMutationDataset = {
        generatedAt: new Date().toISOString(),
        manifestPath,
        outputRoot,
        selectedCategoryIds: selectedCategories.map(c => c.id),
        maxCasesPerCategory: options.maxCasesPerCategory,
        groups: [...options.groups],
        totalCases: selectedCategories.reduce((acc, c) => acc + c.cases.filter(x => x.scored).length, 0),
        totalMutations: mutations.length,
        mutations,
    };

    const manifestOut = path.join(outputRoot, "generated_manifest.json");
    fs.writeFileSync(manifestOut, JSON.stringify(dataset, null, 2), "utf-8");
    return dataset;
}
