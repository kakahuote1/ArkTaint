import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet, type LoadedRuleSet } from "../../core/rules/RuleLoader";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { getSemanticEndpointResolutionRecords } from "../../core/kernel/contracts/PagNodeResolution";
import { collectCaseSeedNodes } from "../helpers/SyntheticCaseHarness";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function copyFileExact(sourceRoot: string, fixtureRoot: string, relativePath: string): void {
    const sourcePath = path.join(sourceRoot, relativePath);
    assert(fs.existsSync(sourcePath), `AnimeZ source file missing: ${sourcePath}`);
    const targetPath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectoryExact(sourceRoot: string, fixtureRoot: string, relativeDir: string): void {
    const sourceDir = path.join(sourceRoot, relativeDir);
    assert(fs.existsSync(sourceDir), `AnimeZ source directory missing: ${sourceDir}`);
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const child = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryExact(sourceRoot, fixtureRoot, child);
            continue;
        }
        if (entry.isFile()) {
            copyFileExact(sourceRoot, fixtureRoot, child);
        }
    }
}

function resolveAnimeZSourceRoot(): string {
    const configured = process.env.ARKTAINT_ANIMEZ_ROOT;
    const projectRoot = configured && configured.trim().length > 0
        ? configured
        : "D:/cursor/workplace/project/AnimeZ";
    const sourceRoot = path.join(projectRoot, "entry", "src", "main", "ets");
    assert(fs.existsSync(sourceRoot), `AnimeZ source root not found: ${sourceRoot}`);
    return sourceRoot;
}

function buildRealAnimeZSliceFixture(fixtureRoot: string): void {
    const sourceRoot = resolveAnimeZSourceRoot();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.mkdirSync(fixtureRoot, { recursive: true });

    const realChainFiles = [
        "pages/SearchPage.ets",
        "pages/WebPage.ets",
        "pages/VideoDetailPage.ets",
        "pages/LocalVideoPlayerPage.ets",
        "api/DataSource.ts",
        "api/DataSourceManager.ets",
        "api/impl/YingHuaDataSource.ts",
        "api/impl/BimiAcgDataSource.ts",
        "utils/HttpUtils.ts",
        "utils/Logger.ts",
        "utils/DataStore.ts",
        "utils/Globals.ets",
        "entity/HomepageData.ts",
        "entity/VideoInfo.ts",
        "entity/VideoDetailInfo.ts",
        "entity/VideoHistoryInfo.ets",
        "entity/VideoCollectionInfo.ts",
        "entity/EpisodeInfo.ts",
        "entity/EpisodeList.ts",
    ];
    for (const relativePath of realChainFiles) {
        copyFileExact(sourceRoot, fixtureRoot, relativePath);
    }
    copyDirectoryExact(sourceRoot, fixtureRoot, "thirdpart/htmlsoup");
    writeSearchPageSupportStubs(fixtureRoot);

    writeText(path.join(fixtureRoot, "SliceEntrypoints.ets"), [
        "import DataSourceManager from './api/DataSourceManager';",
        "import YingHuaDataSource from './api/impl/YingHuaDataSource';",
        "import BimiAcgDataSource from './api/impl/BimiAcgDataSource';",
        "import HttpUtils from './utils/HttpUtils';",
        "",
        "export function animez_F03_yinghua_keyword_to_http_T(taint_src: string): void {",
        "  new YingHuaDataSource().search(taint_src, 1);",
        "}",
        "",
        "export function animez_F04_bimi_keyword_to_http_T(taint_src: string): void {",
        "  new BimiAcgDataSource().search(taint_src, 1);",
        "}",
        "",
        "export function animez_F03_manager_current_source_to_http_T(taint_src: string): void {",
        "  DataSourceManager.getCurrentSource().search(taint_src, 1);",
        "}",
        "",
        "export function animez_F07_http_response_to_hilog_T(): void {",
        "  HttpUtils.getString('http://fixture.invalid/search?q=safe');",
        "}",
        "",
    ].join("\n"));
}

function writeSearchPageSupportStubs(fixtureRoot: string): void {
    writeText(path.join(fixtureRoot, "utils", "Themes.ets"), [
        "export function getTheme(_theme: number): any {",
        "  return {",
        "    background_color_accent: '#fff',",
        "    background_color: '#fff',",
        "    color_text_major: '#111',",
        "    color_text_minor: '#999',",
        "    primary_color: '#0066cc',",
        "    isDarkTheme: false,",
        "    initBar(): void {}",
        "  };",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "utils", "TransitionHelper.ets"), [
        "export const OPTIONS_TRANSITION_PUSH: any = {};",
        "export const OPTIONS_TRANSITION_POP: any = {};",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "components", "ImmersionBarSpace.ets"), [
        "export default function ImmersionBarSpace(): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "components", "CustomPanel.ets"), [
        "export class PanelController {",
        "  show(): void {}",
        "  close(): void {}",
        "  isShow(): boolean { return false; }",
        "}",
        "export default function CustomPanel(_options: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "components", "StateView.ets"), [
        "export enum ViewState {",
        "  LOADING = 0,",
        "  CONTENT,",
        "  EMPTY,",
        "  ERROR,",
        "  CUSTOM",
        "}",
        "export default function StateView(_options: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "components", "VideoList.ets"), [
        "import VideoInfo from '../entity/VideoInfo';",
        "@Component",
        "export struct VideoList {",
        "  videoList: VideoInfo[] = [];",
        "  build(): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "components", "VideoCacheList.ets"), [
        "export function VideoCacheList(_options: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "components", "dialog", "ShareDialog.ets"), [
        "export function ShareDialog(_options: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "db", "SQLite.ets"), [
        "class QueryChain<T = any> {",
        "  queryAll(): Promise<T[]> { return Promise.resolve([]); }",
        "  queryByLink(_value: any): Promise<T | null> { return Promise.resolve(null); }",
        "  queryBySrc(_value: any): Promise<T | null> { return Promise.resolve(null); }",
        "  saveOrUpdate(_value: any): Promise<boolean> { return Promise.resolve(true); }",
        "  save(_value: any): Promise<boolean> { return Promise.resolve(true); }",
        "  insert(_value: any): Promise<boolean> { return Promise.resolve(true); }",
        "  delete(_value: any): Promise<boolean> { return Promise.resolve(true); }",
        "  clearTable(): void {}",
        "}",
        "export default class SQLite {",
        "  static with<T>(_table: any): QueryChain<T> { return new QueryChain<T>(); }",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "db", "impl", "SearchHistoryDao.ets"), [
        "export class SearchHistoryTable {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "db", "impl", "VideoHistoryDao.ets"), [
        "export class VideoHistoryTable {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "db", "impl", "VideoCollectionDao.ets"), [
        "export class VideoCollectionTable {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "entity", "SearchHistoryInfo.ts"), [
        "export interface SearchHistoryInfo {",
        "  id: number;",
        "  keyword: string;",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "player", "IPlayerManager.ets"), [
        "import EpisodeInfo from '../entity/EpisodeInfo';",
        "export enum PlayerStatus { DONE = 1, ERROR = 2 }",
        "export enum VideoFit { CONTAIN = 0 }",
        "export interface PlayerListener {",
        "  onStatusChanged?(status: number): void;",
        "  onEpisodeChanged?(episodeList: EpisodeInfo[], episodeIndex: number): void;",
        "  onVideoSpeedChanged?(videoSpeed: any): void;",
        "  onVideoFitChanged?(videoFit: VideoFit): void;",
        "  onFullScreenChanged?(isFullScreen: boolean): void;",
        "  onVideoSizeChange?(w: number, h: number): void;",
        "  onProgressChange?(totalTime: number, currentTime: number): void;",
        "  onBuffering?(type: any, value: number): void;",
        "}",
        "export default interface IPlayerManager {",
        "  addListener(listener: PlayerListener): void;",
        "  removeListener(listener: PlayerListener): void;",
        "  destroy(): void;",
        "  isPlaying(): boolean;",
        "  start(): void;",
        "  pause(): void;",
        "  enterFullScreen(): void;",
        "  exitFullScreen(): void;",
        "  setStatus(status: PlayerStatus): void;",
        "  playEpisodeList(episodes: EpisodeInfo[], index: number): void;",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "player", "PlayerManagerImpl.ets"), [
        "import IPlayerManager, { PlayerListener, PlayerStatus } from './IPlayerManager';",
        "import EpisodeInfo from '../entity/EpisodeInfo';",
        "export default class PlayerManagerImpl implements IPlayerManager {",
        "  addListener(_listener: PlayerListener): void {}",
        "  removeListener(_listener: PlayerListener): void {}",
        "  destroy(): void {}",
        "  isPlaying(): boolean { return false; }",
        "  start(): void {}",
        "  pause(): void {}",
        "  enterFullScreen(): void {}",
        "  exitFullScreen(): void {}",
        "  setStatus(_status: PlayerStatus): void {}",
        "  playEpisodeList(_episodes: EpisodeInfo[], _index: number): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "player", "MultiVideoPlayer.ets"), [
        "export function MultiVideoPlayer(_options: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "player", "IjkVideoPlayer.ets"), [
        "export function IjkVideoPlayer(_options: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "utils", "Settings.ets"), [
        "export default class Settings {",
        "  static isAutoPlayNextEpisode(): boolean { return false; }",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "utils", "EventBus.ets"), [
        "export const HISTORY_CHANGED_EVENT = { emit(): void {} };",
        "",
    ].join("\n"));
    writeText(path.join(fixtureRoot, "utils", "SystemBarUtils.ets"), [
        "export default class SystemBarUtils {",
        "  static setWindowSystemBarProperties(_options: any): void {}",
        "}",
        "",
    ].join("\n"));
}

function buildScene(projectDir: string): Scene {
    return buildTestScene(projectDir);
}

function findMethod(scene: Scene, name: string): ArkMethod {
    const candidates = scene.getMethods().filter(method => method.getName?.() === name);
    assert(candidates.length === 1, `expected one method named ${name}, got ${candidates.length}`);
    return candidates[0];
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
    return /:member=(?:function|method):(?:(?:instance|static|free-function):)?([^:]+)/.exec(decoded)?.[1] || "";
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

function routerGetParamsSourceRules(rules: readonly SourceRule[]): SourceRule[] {
    return rulesFor({
        rules,
        moduleSpecifier: "@ohos.router",
        memberName: "getParams",
    }) as SourceRule[];
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

function countAcceptedOccurrences(engine: TaintPropagationEngine, rules: readonly (SourceRule | SinkRule)[]): number {
    const ids = new Set(rules.map(canonicalOfRule).filter(Boolean));
    return engine.getOfficialOccurrenceLedger().filter(record =>
        record.status === "accepted" && ids.has(record.canonicalApiId || "")
    ).length;
}

function reachableMethodStates(
    scene: Scene,
    reachable: Set<string>,
    specs: Array<{ label: string; className: string; methodName: string }>,
): Array<{ label: string; found: boolean; reachable: boolean; signatures: string[] }> {
    return specs.map(spec => {
        const methods = scene.getMethods().filter(method =>
            method.getName?.() === spec.methodName
            && method.getDeclaringArkClass?.()?.getName?.() === spec.className
        );
        const signatures = methods.map(method => method.getSignature?.()?.toString?.() || "").filter(Boolean);
        return {
            label: spec.label,
            found: signatures.length > 0,
            reachable: signatures.some(signature => reachable.has(signature)),
            signatures,
        };
    });
}

async function runFullSearchPageSlice(input: {
    scene: Scene;
    loaded: LoadedRuleSet;
    label: string;
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
}): Promise<{
    label: string;
    sourceSeedCount: number;
    acceptedSourceOccurrences: number;
    acceptedSinkOccurrences: number;
    flowCount: number;
    endpointStatuses: string[];
    flowSamples: Array<{
        source: string;
        sink: string;
        sinkEndpoint?: string;
        sinkFactId?: string;
        sourceRuleId?: string;
        sinkRuleId?: string;
    }>;
    postsolve: Array<{
        sink: string;
        judgement: string;
        countability?: string;
        countabilityReason?: string;
        pathCount: number;
        witnessStatus?: string;
        incompleteReasons: string[];
        evidenceKinds: string[];
    }>;
    reachableMethods: Array<{ label: string; found: boolean; reachable: boolean; signatures: string[] }>;
}> {
    const engine = new TaintPropagationEngine(input.scene, 1, {
        apiAssets: input.loaded.assets,
        assetIdentityIndex: input.loaded.assetIdentityIndex,
        canonicalApiRegistry: input.loaded.canonicalApiRegistry,
    });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    const seedInfo = engine.propagateWithSourceRules(input.sourceRules);
    const flows = engine.detectSinksByRules(input.sinkRules, { maxFlowsPerEntry: 20 });
    const postsolveResults = engine.evaluatePostsolveFlowResults(flows, {
        sanitizerRules: input.loaded.ruleSet.sanitizers || [],
        materialize: {
            maxPaths: 128,
            maxDepth: 128,
        },
    });
    const interestingIds = new Set([
        ...input.sourceRules.map(canonicalOfRule),
        ...input.sinkRules.map(canonicalOfRule),
    ].filter(Boolean));
    const endpointStatuses = getSemanticEndpointResolutionRecords(engine.pag)
        .filter(record => interestingIds.has(record.canonicalApiId))
        .map(record => `${record.consumer}:${record.endpointPath}:${record.status}:${record.reason}`);
    return {
        label: input.label,
        sourceSeedCount: seedInfo.seedCount,
        acceptedSourceOccurrences: countAcceptedOccurrences(engine, input.sourceRules),
        acceptedSinkOccurrences: countAcceptedOccurrences(engine, input.sinkRules),
        flowCount: flows.length,
        flowSamples: flows.map(flow => ({
            source: flow.source,
            sink: flow.sink.toString(),
            sinkEndpoint: flow.sinkEndpoint,
            sinkFactId: flow.sinkFactId,
            sourceRuleId: flow.sourceRuleId,
            sinkRuleId: flow.sinkRuleId,
        })),
        postsolve: postsolveResults.results.map(result => ({
            sink: result.flow.sinkText,
            judgement: result.judgement.kind,
            countability: result.countability?.status,
            countabilityReason: result.countability?.reason,
            pathCount: result.paths.length,
            witnessStatus: result.report.witness?.status,
            incompleteReasons: [...(result.report.witness?.incompleteReasons || [])],
            evidenceKinds: [...result.evidenceSummary.evidenceKinds],
        })),
        endpointStatuses,
        reachableMethods: reachableMethodStates(input.scene, reachable, [
            { label: "SearchPage.SearchBar", className: "SearchPage", methodName: "SearchBar" },
            { label: "SearchPage.doSearch", className: "SearchPage", methodName: "doSearch" },
            { label: "WebPage.aboutToAppear", className: "WebPage", methodName: "aboutToAppear" },
            { label: "WebPage.build", className: "WebPage", methodName: "build" },
            { label: "VideoDetailPage.aboutToAppear", className: "VideoDetailPage", methodName: "aboutToAppear" },
            { label: "VideoDetailPage.RootContent", className: "VideoDetailPage", methodName: "RootContent" },
            { label: "VideoDetailPage.VideoDetail", className: "VideoDetailPage", methodName: "VideoDetail" },
            { label: "VideoDetailPage.getDetailInfo", className: "VideoDetailPage", methodName: "getDetailInfo" },
            { label: "VideoDetailPage.playVideo", className: "VideoDetailPage", methodName: "playVideo" },
            { label: "LocalVideoPlayerPage.aboutToAppear", className: "LocalVideoPlayerPage", methodName: "aboutToAppear" },
            { label: "DataSourceManager.getCurrentSource", className: "DataSourceManager", methodName: "getCurrentSource" },
            { label: "DataSourceManager.getSource", className: "DataSourceManager", methodName: "getSource" },
            { label: "YingHuaDataSource.search", className: "YingHuaDataSource", methodName: "search" },
            { label: "BimiAcgDataSource.search", className: "BimiAcgDataSource", methodName: "search" },
            { label: "HttpUtils.getHtml", className: "HttpUtils", methodName: "getHtml" },
            { label: "HttpUtils.getString", className: "HttpUtils", methodName: "getString" },
            { label: "Logger.e", className: "Logger", methodName: "e" },
        ]),
    };
}

async function runSlice(input: {
    scene: Scene;
    loaded: LoadedRuleSet;
    entryName: string;
    sourceMode: "entry-parameter" | "official-source-rules";
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
}): Promise<{
    entryName: string;
    sourceSeedCount: number;
    acceptedSourceOccurrences: number;
    acceptedSinkOccurrences: number;
    flowCount: number;
    endpointStatuses: string[];
}> {
    const entryMethod = findMethod(input.scene, input.entryName);
    const engine = new TaintPropagationEngine(input.scene, 1, {
        apiAssets: input.loaded.assets,
        assetIdentityIndex: input.loaded.assetIdentityIndex,
        canonicalApiRegistry: input.loaded.canonicalApiRegistry,
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);

    let sourceSeedCount = 0;
    if (input.sourceMode === "entry-parameter") {
        const seeds = collectCaseSeedNodes(engine, entryMethod, {
            sourceLocalNames: ["taint_src"],
            includeParameterLocals: true,
        });
        sourceSeedCount = seeds.length;
        engine.propagateWithSeeds(seeds);
    } else {
        const seedInfo = engine.propagateWithSourceRules(input.sourceRules);
        sourceSeedCount = seedInfo.seedCount;
    }

    const flows = engine.detectSinksByRules(input.sinkRules, { maxFlowsPerEntry: 20 });
    const interestingIds = new Set([
        ...input.sourceRules.map(canonicalOfRule),
        ...input.sinkRules.map(canonicalOfRule),
    ].filter(Boolean));
    const endpointStatuses = getSemanticEndpointResolutionRecords(engine.pag)
        .filter(record => interestingIds.has(record.canonicalApiId))
        .map(record => `${record.consumer}:${record.endpointPath}:${record.status}:${record.reason}`);
    return {
        entryName: input.entryName,
        sourceSeedCount,
        acceptedSourceOccurrences: countAcceptedOccurrences(engine, input.sourceRules),
        acceptedSinkOccurrences: countAcceptedOccurrences(engine, input.sinkRules),
        flowCount: flows.length,
        endpointStatuses,
    };
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "animez_real_official_flow_slices");
    const fixtureRoot = resolveTestRunPath("analyze", "animez_real_official_flow_slices", "fixture");
    buildRealAnimeZSliceFixture(fixtureRoot);

    const scene = buildScene(fixtureRoot);
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });

    const sourceRules = loaded.ruleSet.sources || [];
    const sinkRules = loaded.ruleSet.sinks || [];
    const httpRequestSources = rulesFor({
        rules: sourceRules,
        moduleSpecifier: "@ohos.net.http",
        memberName: "request",
    }) as SourceRule[];
    const httpRequestSinks = rulesFor({
        rules: sinkRules,
        moduleSpecifier: "@ohos.net.http",
        memberName: "request",
    }) as SinkRule[];
    const hilogErrorSinks = rulesFor({
        rules: sinkRules,
        moduleSpecifier: "@ohos.hilog",
        memberName: "error",
    }) as SinkRule[];
    const textInputOnChangeSources = textInputOnChangeSourceRules(sourceRules);
    const routerGetParamsSources = routerGetParamsSourceRules(sourceRules);
    const textCallSinks = componentCallSinkRules({
        rules: sinkRules,
        moduleSpecifier: "@internal/component/ets/text",
        componentName: "Text",
    });
    const textInputCallSinks = componentCallSinkRules({
        rules: sinkRules,
        moduleSpecifier: "@internal/component/ets/text_input",
        componentName: "TextInput",
    });
    assert(httpRequestSources.length > 0, "kernel source assets should include @ohos.net.http HttpRequest.request");
    assert(httpRequestSinks.length > 0, "kernel sink assets should include @ohos.net.http HttpRequest.request");
    assert(hilogErrorSinks.length > 0, "kernel sink assets should include @ohos.hilog error");
    assert(textInputOnChangeSources.length > 0, "kernel source assets should include ArkUI TextInput.onChange");
    assert(routerGetParamsSources.length > 0, "kernel source assets should include @ohos.router getParams");
    assert(textCallSinks.length > 0, "kernel sink assets should include ArkUI Text component call");
    assert(textInputCallSinks.length > 0, "kernel sink assets should include ArkUI TextInput component call");

    const fullSlices = [
        {
            label: "animez_F02_full_router_getParams_to_text_T",
            sourceRules: routerGetParamsSources,
            sinkRules: textCallSinks,
            expected: "F02 complete path: real WebPage router.getParams()['url'] -> this.title/this.info -> real ArkUI Text(...)",
        },
        {
            label: "animez_F05_full_router_getParams_to_hilog_T",
            sourceRules: routerGetParamsSources,
            sinkRules: hilogErrorSinks,
            expected: "F05 complete path: real VideoDetailPage/LocalVideoPlayerPage router.getParams() -> real Logger.e -> official hilog.error",
        },
        {
            label: "animez_F06_full_router_getParams_to_http_T",
            sourceRules: routerGetParamsSources,
            sinkRules: httpRequestSinks,
            expected: "F06 complete path: real VideoDetailPage router.getParams()['url'] -> getDetailInfo -> DataSourceManager.getSource(...).getVideoDetailInfo(url) -> real HttpUtils.getHtml/getString -> official HttpRequest.request(url)",
        },
        {
            label: "animez_F07_full_http_response_to_hilog_T",
            sourceRules: httpRequestSources,
            sinkRules: hilogErrorSinks,
            expected: "F07 complete path: real HttpUtils.getString httpRequest.request(...) promiseResult -> Logger.e('getString resp=' + JSON.stringify(resp)) -> official hilog.error",
        },
        {
            label: "animez_F08_full_textinput_to_textinput_ui_T",
            sourceRules: textInputOnChangeSources,
            sinkRules: textInputCallSinks,
            expected: "F08 complete path: real SearchPage TextInput.onChange -> this.keyword -> real TextInput({ text: this.keyword })",
        },
        {
            label: "animez_F03_full_textinput_to_http_T",
            sourceRules: textInputOnChangeSources,
            sinkRules: httpRequestSinks,
            expected: "F03/F04 complete path: real SearchPage TextInput.onChange -> this.keyword -> doSearch -> DataSourceManager.getCurrentSource().search -> real HttpUtils.getHtml/getString -> official HttpRequest.request(url)",
        },
        {
            label: "animez_F01_full_textinput_to_hilog_error_T",
            sourceRules: textInputOnChangeSources,
            sinkRules: hilogErrorSinks,
            expected: "F01 complete path: real SearchPage TextInput.onChange -> this.keyword -> doSearch -> real Logger.e -> official hilog.error",
        },
    ];

    const failures: string[] = [];
    const fullResults: Awaited<ReturnType<typeof runFullSearchPageSlice>>[] = [];
    for (const slice of fullSlices) {
        const result = await runFullSearchPageSlice({
            scene,
            loaded,
            label: slice.label,
            sourceRules: slice.sourceRules,
            sinkRules: slice.sinkRules,
        });
        fullResults.push(result);
        if (result.sourceSeedCount === 0) {
            failures.push(`${slice.label}: no source seed for ${slice.expected}`);
        }
        if (result.acceptedSourceOccurrences === 0) {
            failures.push(`${slice.label}: no accepted official source occurrence for ${slice.expected}`);
        }
        if (result.acceptedSinkOccurrences === 0) {
            failures.push(`${slice.label}: no accepted official sink occurrence for ${slice.expected}`);
        }
        if (result.flowCount === 0) {
            failures.push(`${slice.label}: expected flow missing for ${slice.expected}`);
        }
        if (result.postsolve.length !== result.flowCount) {
            failures.push(`${slice.label}: postsolve result count ${result.postsolve.length} did not match flow count ${result.flowCount}`);
        }
        const nonCountable = result.postsolve.filter(item =>
            item.judgement !== "Confirmed" || item.countability !== "confirmed"
        );
        if (nonCountable.length > 0) {
            failures.push(`${slice.label}: expected all complete raw flows to be countable confirmed, got ${JSON.stringify(nonCountable)}`);
        }
    }

    console.log("====== AnimeZ Real Official Full Flow Slices ======");
    console.log(`fixture=${fixtureRoot}`);
    console.log(`copied_from=${resolveAnimeZSourceRoot()}`);
    for (const result of fullResults) {
        console.log(`${result.label}: seeds=${result.sourceSeedCount} acceptedSource=${result.acceptedSourceOccurrences} acceptedSink=${result.acceptedSinkOccurrences} flows=${result.flowCount}`);
        console.log(`${result.label}: endpoints=${result.endpointStatuses.slice(0, 12).join(" | ") || "none"}`);
        console.log(`${result.label}: reachable=${result.reachableMethods.map(item => `${item.label}:${item.found ? item.reachable ? "reachable" : "not_reachable" : "missing"}`).join(",")}`);
        for (const sample of result.flowSamples.slice(0, 5)) {
            console.log(`${result.label}: flow_sample source=${sample.source} sink=${sample.sink} endpoint=${sample.sinkEndpoint || "N/A"} fact=${sample.sinkFactId || "N/A"}`);
        }
        for (const postsolve of result.postsolve.slice(0, 5)) {
            console.log(`${result.label}: postsolve judgement=${postsolve.judgement} countability=${postsolve.countability || "N/A"} reason=${postsolve.countabilityReason || "N/A"} paths=${postsolve.pathCount} witness=${postsolve.witnessStatus || "N/A"} incomplete=${postsolve.incompleteReasons.join(",") || "none"}`);
        }
    }
    writeText(path.join(root, "animez_real_official_flow_slice_results.json"), JSON.stringify({
        fixtureRoot,
        copiedFrom: resolveAnimeZSourceRoot(),
        copiedRealFiles: [
            "pages/SearchPage.ets",
            "pages/WebPage.ets",
            "pages/VideoDetailPage.ets",
            "pages/LocalVideoPlayerPage.ets",
            "api/DataSource.ts",
            "api/DataSourceManager.ets",
            "api/impl/YingHuaDataSource.ts",
            "api/impl/BimiAcgDataSource.ts",
            "utils/HttpUtils.ts",
            "utils/Logger.ts",
            "utils/DataStore.ts",
            "utils/Globals.ets",
            "entity/HomepageData.ts",
            "entity/VideoInfo.ts",
            "entity/VideoDetailInfo.ts",
            "entity/VideoHistoryInfo.ets",
            "entity/VideoCollectionInfo.ts",
            "entity/EpisodeInfo.ts",
            "entity/EpisodeList.ts",
            "thirdpart/htmlsoup/**",
        ],
        fullSlices,
        fullResults,
        failures,
    }, null, 2));
    if (failures.length > 0) {
        for (const failure of failures) {
            console.log(`failure=${failure}`);
        }
        throw new Error(`AnimeZ real official full flow slices failed: ${failures.join(" | ")}`);
    }
    console.log("PASS test_animez_real_official_flow_slices");
}

main().catch(error => {
    console.error("FAIL test_animez_real_official_flow_slices");
    console.error(error);
    process.exitCode = 1;
});
