import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { getSemanticEndpointResolutionRecords } from "../../core/kernel/contracts/PagNodeResolution";
import { loadRuleSet, type LoadedRuleSet } from "../../core/rules/RuleLoader";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

type SourceKey = "textInputOnChange" | "rdbResultRead" | "httpRequest" | "fsReadText";
type SinkKey = "hilogError" | "httpRequest" | "rdbInsertUpdate" | "fsWrite" | "arkuiImage" | "avPlayerUrlPropertyWrite";

interface ManualSliceCase {
    flowIds: string[];
    entryName: string;
    sourceKey: SourceKey;
    sinkKey: SinkKey;
    path: string;
}

interface ManualSliceResult {
    flowIds: string[];
    entryName: string;
    sourceKey: SourceKey;
    sinkKey: SinkKey;
    path: string;
    sourceRuleCount: number;
    sinkRuleCount: number;
    sourceSeedCount: number;
    acceptedSourceOccurrences: number;
    acceptedSinkOccurrences: number;
    endpointStatuses: string[];
    flowCount: number;
    flowSamples: Array<{
        source: string;
        sink: string;
        sinkEndpoint?: string;
        sinkFactId?: string;
        sourceRuleId?: string;
        sinkRuleId?: string;
    }>;
    postsolve: Array<{
        judgement: string;
        countability?: string;
        countabilityReason?: string;
        pathCount: number;
        incompleteReasons: string[];
        evidenceKinds: string[];
    }>;
    sinkOccurrenceDiagnostics: Array<{
        status: string;
        reasonCode: string;
        syntaxKind: string;
        statementText?: string;
        canonicalApiId?: string;
        candidates: string[];
        importBinding?: unknown;
        receiverBinding?: unknown;
        arkuiComponentEvidence?: unknown;
    }>;
    breakpoint: string;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function decodeCanonicalApiId(canonicalApiId: string): string {
    try {
        return decodeURIComponent(canonicalApiId);
    } catch {
        return canonicalApiId;
    }
}

function canonicalOfRule(rule: SourceRule | SinkRule): string {
    return rule.apiEffect?.canonicalApiId || (rule.match.kind === "canonical_api_id_equals" ? String(rule.match.value) : "");
}

function ruleMemberName(canonicalApiId: string): string {
    const decoded = decodeCanonicalApiId(canonicalApiId);
    return /:member=(?:function|method|property|getter|setter):(?:(?:instance|static|free-function):)?([^:]+)/.exec(decoded)?.[1] || "";
}

function rulesFor(input: {
    rules: readonly (SourceRule | SinkRule)[];
    moduleSpecifier: string;
    memberName: string;
}): Array<SourceRule | SinkRule> {
    return input.rules.filter(rule => {
        const canonicalApiId = canonicalOfRule(rule);
        const decoded = decodeCanonicalApiId(canonicalApiId);
        return decoded.includes(`module=${input.moduleSpecifier}`)
            && ruleMemberName(canonicalApiId) === input.memberName;
    });
}

function rulesForMembers(input: {
    rules: readonly (SourceRule | SinkRule)[];
    moduleSpecifiers: string[];
    memberNames: string[];
}): Array<SourceRule | SinkRule> {
    return input.rules.filter(rule => {
        const canonicalApiId = canonicalOfRule(rule);
        const decoded = decodeCanonicalApiId(canonicalApiId);
        return input.moduleSpecifiers.some(moduleSpecifier => decoded.includes(`module=${moduleSpecifier}`))
            && input.memberNames.includes(ruleMemberName(canonicalApiId));
    });
}

function componentCallSinkRules(input: {
    rules: readonly SinkRule[];
    moduleSpecifier: string;
    componentName: string;
}): SinkRule[] {
    return input.rules.filter(rule => {
        const canonicalApiId = canonicalOfRule(rule);
        const decoded = decodeCanonicalApiId(canonicalApiId);
        return decoded.includes(`module=${input.moduleSpecifier}`)
            && decoded.includes(`export=component:${input.componentName}`)
            && ruleMemberName(canonicalApiId) === "call";
    });
}

function textInputOnChangeSourceRules(rules: readonly SourceRule[]): SourceRule[] {
    return rules.filter(rule => {
        const canonicalApiId = canonicalOfRule(rule);
        const decoded = decodeCanonicalApiId(canonicalApiId);
        return ruleMemberName(canonicalApiId) === "onChange"
            && (
                decoded.includes("TextInput")
                || decoded.includes("module=@internal/component/ets/text")
                || decoded.includes("module=@arkui")
            );
    });
}

function sourceRulesFor(key: SourceKey, rules: readonly SourceRule[]): SourceRule[] {
    if (key === "textInputOnChange") return textInputOnChangeSourceRules(rules);
    if (key === "rdbResultRead") {
        return rulesForMembers({
            rules,
            moduleSpecifiers: ["@ohos.data.relationalStore", "@ohos.data.rdb"],
            memberNames: ["getString", "getLong", "query", "querySql", "querySync", "querySqlSync"],
        }) as SourceRule[];
    }
    if (key === "httpRequest") {
        return rulesFor({ rules, moduleSpecifier: "@ohos.net.http", memberName: "request" }) as SourceRule[];
    }
    return rulesFor({ rules, moduleSpecifier: "@ohos.file.fs", memberName: "readText" }) as SourceRule[];
}

function sinkRulesFor(key: SinkKey, rules: readonly SinkRule[]): SinkRule[] {
    if (key === "hilogError") return rulesFor({ rules, moduleSpecifier: "@ohos.hilog", memberName: "error" }) as SinkRule[];
    if (key === "httpRequest") return rulesFor({ rules, moduleSpecifier: "@ohos.net.http", memberName: "request" }) as SinkRule[];
    if (key === "fsWrite") return rulesFor({ rules, moduleSpecifier: "@ohos.file.fs", memberName: "write" }) as SinkRule[];
    if (key === "arkuiImage") {
        return componentCallSinkRules({
            rules,
            moduleSpecifier: "@internal/component/ets/image",
            componentName: "Image",
        });
    }
    if (key === "avPlayerUrlPropertyWrite") {
        return rulesFor({ rules, moduleSpecifier: "@ohos.multimedia.media", memberName: "url" }) as SinkRule[];
    }
    return rulesForMembers({
        rules,
        moduleSpecifiers: ["@ohos.data.relationalStore", "@ohos.data.rdb"],
        memberNames: ["insert", "update", "batchInsert"],
    }) as SinkRule[];
}

function diagnosticMemberHintsForSinkKey(key: SinkKey): string[] {
    if (key === "rdbInsertUpdate") return ["insert", "update", "batchInsert"];
    if (key === "fsWrite") return ["write", "writeSync"];
    if (key === "arkuiImage") return ["Image", "create"];
    if (key === "avPlayerUrlPropertyWrite") return ["url"];
    return [];
}

function collectSinkOccurrenceDiagnostics(engine: TaintPropagationEngine, key: SinkKey): ManualSliceResult["sinkOccurrenceDiagnostics"] {
    const hints = diagnosticMemberHintsForSinkKey(key);
    if (hints.length === 0) return [];
    return engine.getOfficialOccurrenceLedger()
        .filter(record => {
            const statement = String(record.statementText || "");
            const memberName = String(record.evidence.memberName || "");
            const canonicalApiId = decodeCanonicalApiId(String(record.canonicalApiId || ""));
            return hints.some(hint =>
                statement.includes(hint)
                || memberName === hint
                || canonicalApiId.includes(`:${hint}`)
                || canonicalApiId.includes(`=${hint}`)
            );
        })
        .map(record => ({
            status: record.status,
            reasonCode: record.reasonCode,
            syntaxKind: record.syntaxKind,
            statementText: record.statementText,
            canonicalApiId: record.canonicalApiId,
            candidates: [...record.candidates],
            importBinding: record.evidence.importBinding,
            receiverBinding: record.evidence.receiverBinding,
            arkuiComponentEvidence: record.evidence.arkuiComponentEvidence,
        }));
}

function maybePrintObservedFactDebug(engine: TaintPropagationEngine, item: ManualSliceCase): void {
    if (process.env.ARKTAINT_SLICE_DEBUG_FACTS !== "1") return;
    const filter = process.env.ARKTAINT_SLICE_DEBUG_FILTER || "";
    if (filter && !item.flowIds.includes(filter) && !item.entryName.includes(filter)) return;
    const needles = (process.env.ARKTAINT_SLICE_DEBUG_NEEDLES || "keyword,url,request,search,doSearch,getString")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
    const rows: Array<{
        id: string;
        nodeId: number;
        context: number;
        field?: string;
        method: string;
        stmt: string;
        value: string;
    }> = [];
    for (const facts of engine.getObservedTaintFacts().values()) {
        for (const fact of facts) {
            const node = fact.node as any;
            const stmt = node.getStmt?.() || node.stmt;
            const method = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
            const stmtText = stmt?.toString?.() || "";
            const value = node.getValue?.()?.toString?.() || "";
            const text = `${fact.id} ${method} ${stmtText} ${value}`;
            if (!needles.some(needle => text.includes(needle))) continue;
            rows.push({
                id: fact.id,
                nodeId: node.getID?.() ?? -1,
                context: fact.contextID,
                field: fact.field?.join("."),
                method,
                stmt: stmtText,
                value,
            });
        }
    }
    console.log(`slice_debug_facts ${item.flowIds.join(",")} count=${rows.length}`);
    for (const row of rows.slice(0, 120)) {
        console.log(`slice_debug_fact ${JSON.stringify(row)}`);
    }
}

function countAcceptedOccurrences(engine: TaintPropagationEngine, rules: readonly (SourceRule | SinkRule)[]): number {
    const ids = new Set(rules.map(canonicalOfRule).filter(Boolean));
    return engine.getOfficialOccurrenceLedger().filter(record =>
        record.status === "accepted" && ids.has(record.canonicalApiId || "")
    ).length;
}

function findMethod(scene: Scene, name: string): ArkMethod {
    const candidates = scene.getMethods().filter(method => method.getName?.() === name);
    assert(candidates.length === 1, `expected one method named ${name}, got ${candidates.length}`);
    return candidates[0];
}

function chooseBreakpoint(input: {
    sourceSeedCount: number;
    acceptedSourceOccurrences: number;
    acceptedSinkOccurrences: number;
    endpointStatuses: string[];
    flowCount: number;
    postsolve: ManualSliceResult["postsolve"];
}): string {
    if (input.sourceSeedCount === 0) return "no_source_seed";
    if (input.acceptedSourceOccurrences === 0) return "no_accepted_source_occurrence";
    if (input.acceptedSinkOccurrences === 0) return "no_accepted_sink_occurrence";
    if (input.endpointStatuses.length === 0) return "no_endpoint_projection";
    if (input.flowCount === 0) return "no_raw_flow";
    if (input.postsolve.some(item => item.judgement === "Confirmed" && item.countability === "confirmed")) {
        return "countable";
    }
    return "postsolve_not_countable";
}

function manualCases(): ManualSliceCase[] {
    return [
        {
            flowIds: ["F01"],
            entryName: "animez_F01_F03_search_textinput_to_log_and_yinghua_http_T",
            sourceKey: "textInputOnChange",
            sinkKey: "hilogError",
            path: "SearchPage TextInput.onChange -> this.keyword -> doSearch -> Logger.e -> hilog.error",
        },
        {
            flowIds: ["F03"],
            entryName: "animez_F01_F03_search_textinput_to_log_and_yinghua_http_T",
            sourceKey: "textInputOnChange",
            sinkKey: "httpRequest",
            path: "SearchPage TextInput.onChange -> doSearch -> YingHuaDataSource.search -> encodeURIComponent/url concat -> http.request",
        },
        {
            flowIds: ["F02"],
            entryName: "animez_F02_search_textinput_to_rdb_T",
            sourceKey: "textInputOnChange",
            sinkKey: "rdbInsertUpdate",
            path: "SearchPage TextInput.onChange -> doSearch -> SearchHistoryTable.saveOrUpdate -> AbsTable.insert/update -> RDB",
        },
        {
            flowIds: ["F04"],
            entryName: "animez_F04_search_textinput_to_bimi_http_T",
            sourceKey: "textInputOnChange",
            sinkKey: "httpRequest",
            path: "SearchPage TextInput.onChange -> doSearch -> BimiAcgDataSource.search -> encodeURIComponent/url concat -> http.request",
        },
        {
            flowIds: ["F05"],
            entryName: "animez_F05_F06_rdb_history_to_log_and_http_T",
            sourceKey: "rdbResultRead",
            sinkKey: "hilogError",
            path: "RDB ResultSet.getString(keyword) -> SearchHistoryInfo.keyword -> SearchPage.doSearch -> Logger.e -> hilog.error",
        },
        {
            flowIds: ["F06"],
            entryName: "animez_F05_F06_rdb_history_to_log_and_http_T",
            sourceKey: "rdbResultRead",
            sinkKey: "httpRequest",
            path: "RDB ResultSet.getString(keyword) -> SearchPage.doSearch -> DataSource.search -> HttpUtils.getString -> http.request",
        },
        {
            flowIds: ["F07"],
            entryName: "animez_F07_http_response_to_hilog_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "HttpUtils.getString http.request response -> Logger.e(JSON.stringify(resp)) -> hilog.error",
        },
        {
            flowIds: ["F08", "F09"],
            entryName: "animez_F08_F09_homepage_http_to_logs_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "Homepage HttpUtils.getString response -> getHomepageData/parseHtml -> Recommend.loadNextPage Logger.e -> hilog.error",
        },
        {
            flowIds: ["F10"],
            entryName: "animez_F10_F11_F12_remote_video_to_router_image_detail_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "HTTP remote VideoInfo -> VideoList.router.pushUrl params -> VideoDetailPage.router.getParams -> Logger.e",
        },
        {
            flowIds: ["F11"],
            entryName: "animez_F10_F11_F12_remote_video_to_router_image_detail_T",
            sourceKey: "httpRequest",
            sinkKey: "httpRequest",
            path: "HTTP remote VideoInfo.url -> router params -> VideoDetailPage.getDetailInfo(url) -> HttpUtils.getString -> http.request",
        },
        {
            flowIds: ["F12"],
            entryName: "animez_F10_F11_F12_remote_video_to_router_image_detail_T",
            sourceKey: "httpRequest",
            sinkKey: "arkuiImage",
            path: "HTTP remote VideoInfo.imgUrl -> VideoList.VideoItem -> Image(item.imgUrl)",
        },
        {
            flowIds: ["F13", "F14", "F15", "F20", "F21", "F23"],
            entryName: "animez_F13_F15_F20_F21_F23_detail_play_logs_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "Detail/play HTTP response -> VideoDetailInfo/EpisodeInfo/parseVideoUrl/player URL logs -> hilog.error",
        },
        {
            flowIds: ["F16", "F17"],
            entryName: "animez_F16_F19_detail_objects_to_rdb_and_logs_T",
            sourceKey: "httpRequest",
            sinkKey: "rdbInsertUpdate",
            path: "Detail HTTP response -> VideoHistoryInfo/VideoCollectionInfo -> DAO -> RDB insert/update",
        },
        {
            flowIds: ["F18", "F19"],
            entryName: "animez_F16_F19_detail_objects_to_rdb_and_logs_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "Detail HTTP response -> DAO save/query Logger.e(JSON.stringify(item/info)) -> hilog.error",
        },
        {
            flowIds: ["F22"],
            entryName: "animez_F22_episode_video_url_to_avplayer_url_T",
            sourceKey: "httpRequest",
            sinkKey: "avPlayerUrlPropertyWrite",
            path: "Detail HTTP response -> EpisodeInfo.videoUrl -> PlayerManagerImpl.setPlayerUrl -> AVPlayerWrapper.avPlayer.url",
        },
        {
            flowIds: ["F24"],
            entryName: "animez_F24_F26_episode_link_to_m3u8_init_T",
            sourceKey: "httpRequest",
            sinkKey: "fsWrite",
            path: "Detail HTTP response EpisodeInfo.link -> M3U8Downloader.with/build/init -> saveVideoInfo -> fs.write(video.info)",
        },
        {
            flowIds: ["F25"],
            entryName: "animez_F24_F26_episode_link_to_m3u8_init_T",
            sourceKey: "httpRequest",
            sinkKey: "rdbInsertUpdate",
            path: "EpisodeInfo.link -> M3U8Downloader taskInfo -> DownloadTaskInfoRepository/FileDownloadTable -> RDB",
        },
        {
            flowIds: ["F26"],
            entryName: "animez_F24_F26_episode_link_to_m3u8_init_T",
            sourceKey: "httpRequest",
            sinkKey: "httpRequest",
            path: "EpisodeInfo.link -> M3U8Downloader.initTask -> parseVideoUrl(originalUrl) -> http.request",
        },
        {
            flowIds: ["F27"],
            entryName: "animez_F27_F29_m3u8_http_text_to_logs_and_fs_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "M3U8Utils.parse HttpUtils.getString response -> parse/content/segment Logger.e -> hilog.error",
        },
        {
            flowIds: ["F28", "F29"],
            entryName: "animez_F27_F29_m3u8_http_text_to_logs_and_fs_T",
            sourceKey: "httpRequest",
            sinkKey: "fsWrite",
            path: "M3U8 HTTP text -> saveM3U8LocalInfo/saveM3U8OriginInfo -> fs.write",
        },
        {
            flowIds: ["F30", "F31"],
            entryName: "animez_F30_F33_m3u8_segment_key_to_child_tasks_T",
            sourceKey: "httpRequest",
            sinkKey: "rdbInsertUpdate",
            path: "M3U8 HTTP text -> segment/key URL -> child DownloadTaskInfo -> repository -> RDB",
        },
        {
            flowIds: ["F32", "F33"],
            entryName: "animez_F30_F33_m3u8_segment_key_to_child_tasks_T",
            sourceKey: "httpRequest",
            sinkKey: "httpRequest",
            path: "M3U8 HTTP text -> segment/key URL -> FileDownloadTask.download -> http.request",
        },
        {
            flowIds: ["F34", "F35"],
            entryName: "animez_F34_F36_download_http_response_to_fs_and_log_T",
            sourceKey: "httpRequest",
            sinkKey: "fsWrite",
            path: "FileDownloadTask.download HTTP response ArrayBuffer -> save/saveSlice -> fs.write",
        },
        {
            flowIds: ["F36"],
            entryName: "animez_F34_F36_download_http_response_to_fs_and_log_T",
            sourceKey: "httpRequest",
            sinkKey: "hilogError",
            path: "FileDownloadTask.download HTTP response -> Logger.e(resp) -> hilog.error",
        },
        {
            flowIds: ["F37"],
            entryName: "animez_F37_video_info_read_to_hilog_min_T",
            sourceKey: "fsReadText",
            sinkKey: "hilogError",
            path: "M3U8Downloader.doRestore/prepare fs.readText(video.info) -> Logger.e(text/videoInfo) -> hilog.error",
        },
        {
            flowIds: ["F38"],
            entryName: "animez_F38_video_info_read_to_followup_http_min_T",
            sourceKey: "fsReadText",
            sinkKey: "httpRequest",
            path: "fs.readText(video.info) -> JSON.parse -> videoInfo.m3u8 -> child FileDownloadTask.download -> http.request",
        },
    ];
}

async function runCase(scene: Scene, loaded: LoadedRuleSet, item: ManualSliceCase): Promise<ManualSliceResult> {
    const sourceRules = sourceRulesFor(item.sourceKey, loaded.ruleSet.sources || []);
    const sinkRules = sinkRulesFor(item.sinkKey, loaded.ruleSet.sinks || []);
    const method = findMethod(scene, item.entryName);
    const engine = new TaintPropagationEngine(scene, 1, {
        apiAssets: loaded.assets,
        assetIdentityIndex: loaded.assetIdentityIndex,
        canonicalApiRegistry: loaded.canonicalApiRegistry,
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [method],
    });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules, { maxFlowsPerEntry: 30 });
    const postsolveResults = engine.evaluatePostsolveFlowResults(flows, {
        sanitizerRules: loaded.ruleSet.sanitizers || [],
        materialize: {
            maxPaths: 160,
            maxDepth: 160,
        },
    });
    const interestingIds = new Set([
        ...sourceRules.map(canonicalOfRule),
        ...sinkRules.map(canonicalOfRule),
    ].filter(Boolean));
    const endpointStatuses = getSemanticEndpointResolutionRecords(engine.pag)
        .filter(record => interestingIds.has(record.canonicalApiId))
        .map(record => `${record.consumer}:${record.endpointPath}:${record.status}:${record.reason}`);
    const postsolve = postsolveResults.results.map(result => ({
        judgement: result.judgement.kind,
        countability: result.countability?.status,
        countabilityReason: result.countability?.reason,
        pathCount: result.paths.length,
        incompleteReasons: [...(result.report.witness?.incompleteReasons || [])],
        evidenceKinds: [...result.evidenceSummary.evidenceKinds],
    }));
    maybePrintObservedFactDebug(engine, item);
    const acceptedSourceOccurrences = countAcceptedOccurrences(engine, sourceRules);
    const acceptedSinkOccurrences = countAcceptedOccurrences(engine, sinkRules);
    return {
        ...item,
        sourceRuleCount: sourceRules.length,
        sinkRuleCount: sinkRules.length,
        sourceSeedCount: seedInfo.seedCount,
        acceptedSourceOccurrences,
        acceptedSinkOccurrences,
        endpointStatuses,
        flowCount: flows.length,
        flowSamples: flows.map(flow => ({
            source: flow.source,
            sink: flow.sink.toString(),
            sinkEndpoint: flow.sinkEndpoint,
            sinkFactId: flow.sinkFactId,
            sourceRuleId: flow.sourceRuleId,
            sinkRuleId: flow.sinkRuleId,
        })),
        postsolve,
        sinkOccurrenceDiagnostics: collectSinkOccurrenceDiagnostics(engine, item.sinkKey),
        breakpoint: chooseBreakpoint({
            sourceSeedCount: seedInfo.seedCount,
            acceptedSourceOccurrences,
            acceptedSinkOccurrences,
            endpointStatuses,
            flowCount: flows.length,
            postsolve,
        }),
    };
}

function writeMarkdown(filePath: string, results: ManualSliceResult[]): void {
    const lines = [
        "# AnimeZ Manual Official Path Slice Results",
        "",
        "这些结果来自手工摘取的最小路径切片，不是完整 AnimeZ 运行，也不是脚本自动对比。",
        "",
        "| flow | entry | source | sink | breakpoint | seeds | accepted source | accepted sink | raw flows | endpoints | path |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|---|",
    ];
    for (const result of results) {
        lines.push(`| ${result.flowIds.join(",")} | ${result.entryName} | ${result.sourceKey} | ${result.sinkKey} | ${result.breakpoint} | ${result.sourceSeedCount} | ${result.acceptedSourceOccurrences} | ${result.acceptedSinkOccurrences} | ${result.flowCount} | ${result.endpointStatuses.length} | ${result.path.replace(/\|/g, "/")} |`);
    }
    writeText(filePath, lines.join("\n") + "\n");
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/animez_official_path_slices");
    const runDir = resolveTestRunDir("analyze", "animez_manual_official_path_slices");
    const scene = buildTestScene(sourceDir);
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const selectedText = process.argv.slice(2).join(",");
    const selected = (selectedText || process.env.ARKTAINT_ANIMEZ_MANUAL_SLICE || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    const cases = manualCases().filter(item => {
        if (selected.length === 0) return true;
        return selected.some(key =>
            item.entryName.includes(key)
            || item.flowIds.some(flowId => flowId.toLowerCase() === key.toLowerCase())
        );
    });
    console.log(`animez_manual_path_slice_cases=${cases.length} selected=${selected.join(",") || "all"}`);
    const results: ManualSliceResult[] = [];
    for (let index = 0; index < cases.length; index++) {
        const item = cases[index];
        console.log(`slice_start ${index + 1}/${cases.length} ${item.flowIds.join(",")} ${item.entryName} ${item.sourceKey}->${item.sinkKey}`);
        const result = await runCase(scene, loaded, item);
        results.push(result);
        writeText(path.join(runDir, "animez_manual_official_path_slice_results.json"), JSON.stringify({
            sourceDir,
            selected,
            completed: results.length,
            total: cases.length,
            cases,
            results,
            byBreakpoint: results.reduce<Record<string, number>>((acc, current) => {
                acc[current.breakpoint] = (acc[current.breakpoint] || 0) + 1;
                return acc;
            }, {}),
        }, null, 2));
        writeMarkdown(path.join(runDir, "animez_manual_official_path_slice_results.md"), results);
        console.log(`slice_result ${item.flowIds.join(",")} breakpoint=${result.breakpoint} seeds=${result.sourceSeedCount} acceptedSource=${result.acceptedSourceOccurrences} acceptedSink=${result.acceptedSinkOccurrences} flows=${result.flowCount} endpoints=${result.endpointStatuses.length}`);
        for (const sample of result.flowSamples.slice(0, 2)) {
            console.log(`slice_flow ${item.flowIds.join(",")} source=${sample.source} sink=${sample.sink} endpoint=${sample.sinkEndpoint || "N/A"} fact=${sample.sinkFactId || "N/A"}`);
        }
        for (const postsolve of result.postsolve.slice(0, 2)) {
            console.log(`slice_postsolve ${item.flowIds.join(",")} judgement=${postsolve.judgement} countability=${postsolve.countability || "N/A"} reason=${postsolve.countabilityReason || "N/A"} paths=${postsolve.pathCount} incomplete=${postsolve.incompleteReasons.join(",") || "none"}`);
        }
    }
    writeText(path.join(runDir, "animez_manual_official_path_slice_results.json"), JSON.stringify({
        sourceDir,
        selected,
        completed: results.length,
        total: cases.length,
        cases,
        results,
        byBreakpoint: results.reduce<Record<string, number>>((acc, result) => {
            acc[result.breakpoint] = (acc[result.breakpoint] || 0) + 1;
            return acc;
        }, {}),
    }, null, 2));
    writeMarkdown(path.join(runDir, "animez_manual_official_path_slice_results.md"), results);
    console.log(`results=${path.join(runDir, "animez_manual_official_path_slice_results.json")}`);
    console.log("PASS test_animez_manual_official_path_slices");
}

main().catch(error => {
    console.error("FAIL test_animez_manual_official_path_slices");
    console.error(error);
    process.exitCode = 1;
});
