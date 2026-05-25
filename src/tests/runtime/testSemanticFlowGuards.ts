import * as fs from "fs";
import * as path from "path";
import { normalizeNoCandidateItem } from "../../core/model/callsite/callsiteContextSlices";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../../core/model/callsite/callsiteContextSlices";
import { splitArkMainEntryCandidatesForSemanticFlow } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateFilter";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import {
    suppressInvalidResolvedSemanticFlowArtifact,
    suppressKnownNonArtifactSemanticFlowCandidate,
} from "../../core/semanticflow/SemanticFlowArtifactGuards";
import { buildSemanticFlowArtifact } from "../../core/semanticflow/SemanticFlowArtifacts";
import { createArkMainCandidateExpander } from "../../core/semanticflow/SemanticFlowExpanders";
import type { ArkMainEntryCandidate } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildFakeArkMainCandidate(methodSignature: string): ArkMainEntryCandidate {
    const fakeMethod = {
        getCfg() {
            return {
                getStmts() {
                    return [
                        {
                            getOriginalText() {
                                return "const payload = want;";
                            },
                        },
                    ];
                },
            };
        },
    };
    return {
        method: fakeMethod as any,
        methodSignature,
        className: "DemoAbility",
        methodName: "onCreate",
        filePath: "entry/src/main/ets/EntryAbility.ets",
        superClassName: "UIAbility",
        parameterTypes: ["Want"],
        returnType: "void",
        isOverride: true,
        ownerSignals: ["owner_contract:ability_owner:framework_contract"],
        overrideSignals: ["override:explicit"],
        frameworkSignals: ["framework_hint:ability", "framework_hint:want"],
    };
}

async function main(): Promise<void> {
    const ruleA = normalizeNoCandidateItem({
        callee_signature: "<@A: Box.cloneValue(string)>",
        method: "cloneValue",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "entry/src/main/ets/box.ets",
    });
    const ruleB = normalizeNoCandidateItem({
        callee_signature: "<@B: Box.cloneValue(string)>",
        method: "cloneValue",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "entry/src/main/ets/box.ets",
    });
    const ruleItemA = buildSemanticFlowRuleCandidateItem(ruleA);
    const ruleItemB = buildSemanticFlowRuleCandidateItem(ruleB);
    assert(ruleItemA.anchor.id !== ruleItemB.anchor.id, "rule anchor ids must stay unique across same-name signatures");
    const ruleWithMethodSnippet = buildSemanticFlowRuleCandidateItem({
        ...ruleA,
        methodSnippet: [
            "   80 | public static getParams(): Object {",
            "   81 |   return router.getParams()",
            "   82 | }",
        ].join("\n"),
        ownerSnippet: [
            "imports:",
            "    1 | import router from '@ohos.router'",
            "",
            "ownerMethods:",
            "   80 | public static push(options: RouterOptions) {",
            "  120 | public static back(options?: RouterOptions) {",
            "  154 | public static getParams(): Object {",
        ].join("\n"),
        ownerMethodSnippets: [
            {
                method: "push",
                code: "   80 | public static push(options: RouterOptions) {\n   81 |   router.pushUrl({ url: options.url, params: options.params }, router.RouterMode.Standard)\n   82 | }",
            },
        ],
        contextError: "no_matching_invoke_found_in_scene",
    } as any);
    assert(ruleWithMethodSnippet.initialSlice.snippets[0]?.label === "method", "rule slice should surface method snippet before candidate fallback");
    assert(ruleWithMethodSnippet.initialSlice.snippets[0]?.code.includes("return router.getParams()"), "rule slice should preserve callee body when no callsite exists");
    assert(ruleWithMethodSnippet.initialSlice.template === "multi-surface", "wrapper-like rule slice should become multi-surface when owner-family evidence exists");
    assert(ruleWithMethodSnippet.initialSlice.snippets.some(snippet => snippet.label === "owner-context"), "wrapper-like rule slice should include owner context");
    assert(ruleWithMethodSnippet.initialSlice.snippets.some(snippet => snippet.label === "owner-sibling-push"), "wrapper-like rule slice should include owner sibling snippet");
    assert((ruleWithMethodSnippet.initialSlice.companions || []).includes("push"), "wrapper-like rule slice should expose owner sibling as companion");
    assert(ruleWithMethodSnippet.initialSlice.observations.includes("methodSnippet=available"), "rule slice should record method snippet availability");
    assert(ruleWithMethodSnippet.initialSlice.observations.includes("ownerMethodSnippets=1"), "rule slice should record owner family evidence");

    const abstractRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/abstract_method_snippet");
    const abstractSourceDir = path.join(abstractRoot, "feature/src/main/ets");
    const abstractDecoyDir = path.join(abstractRoot, "entry/src/main/ets");
    fs.rmSync(abstractRoot, { recursive: true, force: true });
    fs.mkdirSync(abstractSourceDir, { recursive: true });
    fs.mkdirSync(abstractDecoyDir, { recursive: true });
    fs.writeFileSync(path.join(abstractDecoyDir, "BaseViewModel.ets"), [
        "export class BaseViewModel {",
        "  other(): void {}",
        "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(abstractSourceDir, "BaseViewModel.ets"), [
        "export abstract class BaseViewModel {",
        "  protected abstract processIntentWithModel(intention: BaseIntent, model: BaseModel, state: BaseState): Promise<ProcessResult>;",
        "  protected processIntentWithModelSync(intention: BaseIntent, model: BaseModel, state: BaseState): ProcessResult {",
        "    return ProcessResult.SUCCESS;",
        "  }",
        "}",
    ].join("\n"), "utf8");
    const enrichedAbstract = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: abstractRoot,
        sourceDirs: ["entry/src/main/ets", "feature/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/BaseViewModel.ets: BaseViewModel.processIntentWithModel(BaseIntent, BaseModel, BaseState)",
            method: "processIntentWithModel",
            invokeKind: "instance",
            argCount: 3,
            sourceFile: "ets/BaseViewModel.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    const abstractSnippet = String((enrichedAbstract[0] as any).methodSnippet || "");
    assert(abstractSnippet.includes("protected abstract processIntentWithModel"), "abstract method declarations should be extracted as method snippets");
    assert(!abstractSnippet.includes("processIntentWithModelSync"), "declaration-only method snippet should stop at the semicolon");

    const ownerScopedRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/owner_scoped_method_snippet");
    const ownerScopedSourceDir = path.join(ownerScopedRoot, "entry/src/main/ets");
    fs.rmSync(ownerScopedRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(ownerScopedSourceDir, "components"), { recursive: true });
    fs.writeFileSync(path.join(ownerScopedSourceDir, "components/NoteContent.ets"), [
        "export struct ToolBarComp {",
        "  confirm(excuteJs: string) {",
        "    this.controllerShow.runJavaScript(excuteJs);",
        "  }",
        "}",
        "export struct NoteContentOverViewComp {",
        "  confirm(newTitle: string) {",
        "    this.selectedNoteData.title = newTitle;",
        "    RdbStoreUtil.update(this.selectedNoteData.toNoteObject(), predicates_note, null);",
        "  }",
        "}",
    ].join("\n"), "utf8");
    const enrichedOwnerScoped = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: ownerScopedRoot,
        sourceDirs: ["entry/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/components/NoteContent.ets: NoteContentOverViewComp.confirm(string)",
            method: "confirm",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "ets/components/NoteContent.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    const ownerScopedSnippet = String((enrichedOwnerScoped[0] as any).methodSnippet || "");
    assert(ownerScopedSnippet.includes("this.selectedNoteData.title = newTitle"), "same-file same-name methods should use the owner-scoped callee body");
    assert(!ownerScopedSnippet.includes("runJavaScript(excuteJs)"), "owner-scoped snippet selection must not leak a sibling struct method body");

    const syntheticRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/synthetic_method_snippet");
    const syntheticSourceDir = path.join(syntheticRoot, "entry/src/main/ets");
    fs.rmSync(syntheticRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(syntheticSourceDir, "entryability"), { recursive: true });
    fs.writeFileSync(path.join(syntheticSourceDir, "entryability/EntryAbility.ets"), [
        "export default class EntryAbility {",
        "  async onWindowStageCreate(windowStage: WindowStage): Promise<void> {",
        "    await this.initStore();",
        "    windowStage.loadContent('view/EntryPage', (_) => {",
        "      UIInitializer.init(windowStage, this.context);",
        "    });",
        "  }",
        "  initStore(): Promise<void> {",
        "    return Promise.resolve();",
        "  }",
        "}",
    ].join("\n"), "utf8");
    const enrichedSynthetic = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: syntheticRoot,
        sourceDirs: ["entry/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/entryability/EntryAbility.ets: EntryAbility.%AM0$onWindowStageCreate([windowStage], unknown)",
            method: "%AM0$onWindowStageCreate",
            invokeKind: "instance",
            argCount: 2,
            sourceFile: "ets/entryability/EntryAbility.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    const syntheticSnippet = String((enrichedSynthetic[0] as any).methodSnippet || "");
    assert(syntheticSnippet.includes("onWindowStageCreate(windowStage"), "synthetic method should fall back to its source host method body");
    assert(syntheticSnippet.includes("windowStage.loadContent"), "synthetic fallback should preserve host method body evidence");
    assert((enrichedSynthetic[0] as any).methodSnippetSource === "onWindowStageCreate", "synthetic fallback should record the source method name");
    const syntheticItem = buildSemanticFlowRuleCandidateItem(enrichedSynthetic[0]);
    assert(syntheticItem.initialSlice.observations.includes("methodSnippet=available"), "synthetic fallback should expose method snippet availability");
    assert(syntheticItem.initialSlice.observations.includes("methodSnippetSource=onWindowStageCreate"), "synthetic fallback should expose source method name");
    assert(syntheticItem.initialSlice.snippets.some(snippet => snippet.label === "method" && snippet.code.includes("UIInitializer.init")), "synthetic fallback should place host method body in the prompt slice");

    const syntheticArrowRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/synthetic_arrow_wrapper");
    const syntheticArrowSourceDir = path.join(syntheticArrowRoot, "entry/src/main/ets");
    fs.rmSync(syntheticArrowRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(syntheticArrowSourceDir, "api"), { recursive: true });
    fs.writeFileSync(path.join(syntheticArrowSourceDir, "api/user.ets"), [
        "import { http } from '../common/utils/Request';",
        "export const sendSMSCodeApi = (phone: string): Promise<void> => {",
        "  return http.post<void>('/sendSMSCode', { phone });",
        "};",
        "export const loginApi = (phone: string, code: string): Promise<LoginResModel> => {",
        "  return http.post<LoginResModel>('/login', { phone, code });",
        "};",
    ].join("\n"), "utf8");
    const enrichedSyntheticArrow = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: syntheticArrowRoot,
        sourceDirs: ["entry/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/api/user.ets: %dflt.%AM1(string, string)",
            method: "%AM1",
            invokeKind: "instance",
            argCount: 2,
            sourceFile: "ets/api/user.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    const syntheticArrowSnippet = String((enrichedSyntheticArrow[0] as any).methodSnippet || "");
    assert(syntheticArrowSnippet.includes("loginApi = (phone: string, code: string)"), "lowered arrow wrapper should resolve to the matching source-level function by arity");
    assert(!syntheticArrowSnippet.includes("sendSMSCodeApi ="), "lowered arrow wrapper should not use a different arity wrapper body");
    assert((enrichedSyntheticArrow[0] as any).methodSnippetSource === "loginApi", "lowered arrow wrapper should record the source-level function name");

    const callbackRelayRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/callback_field_relay");
    const callbackRelaySourceDir = path.join(callbackRelayRoot, "entry/src/main/ets");
    fs.rmSync(callbackRelayRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(callbackRelaySourceDir, "p2p"), { recursive: true });
    fs.writeFileSync(path.join(callbackRelaySourceDir, "p2p/Relay.ets"), [
        "export class Relay {",
        "  private incomingHandler?: (payload: string) => void;",
        "  setIncomingHandler(handler: (payload: string) => void): void {",
        "    this.incomingHandler = handler;",
        "  }",
        "  registerReceiver(): void {",
        "    const text: string = 'payload';",
        "    if (this.incomingHandler) {",
        "      this.incomingHandler(text);",
        "    }",
        "  }",
        "}",
    ].join("\n"), "utf8");
    const enrichedCallbackRelay = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: callbackRelayRoot,
        sourceDirs: ["entry/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/p2p/Relay.ets: Relay.%AM0(string)",
            method: "%AM0",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "ets/p2p/Relay.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 2,
        cfgNeighborRadius: 2,
    });
    const callbackRelayItem = enrichedCallbackRelay[0] as any;
    assert(Array.isArray(callbackRelayItem.contextSlices) && callbackRelayItem.contextSlices.length > 0, "callback field invocation should keep callsite context");
    assert(Array.isArray(callbackRelayItem.ownerMethodSnippets), "callback field invocation should get owner companion snippets even without a method body");
    assert(
        callbackRelayItem.ownerMethodSnippets.some((snippet: any) =>
            snippet.method === "setIncomingHandler" && String(snippet.code || "").includes("this.incomingHandler = handler"),
        ),
        "callback field invocation should expose the setter companion that stores the callback",
    );

    const arkCandidateA = buildFakeArkMainCandidate("<@Entry: DemoAbility.onCreate(Want)>");
    const arkCandidateB = buildFakeArkMainCandidate("<@Entry: DemoAbility.onCreate(Want,string)>");
    const split = splitArkMainEntryCandidatesForSemanticFlow([arkCandidateA, {
        ...arkCandidateB,
        methodName: "loadContent",
        isOverride: false,
        ownerSignals: ["owner_contract:ability_owner:framework_contract"],
        overrideSignals: [],
        superClassName: "UIAbility",
    }, {
        ...arkCandidateB,
        methodName: "onSave",
        className: "AccountForm",
        superClassName: "CustomComponent",
        ownerSignals: ["owner_contract:component_owner:framework_contract"],
        overrideSignals: [],
        frameworkSignals: ["framework_hint:component", "framework_hint:ui"],
    }]);
    assert(split.kernelCoveredCandidates.length === 1, `expected one kernel-covered arkmain candidate, got ${split.kernelCoveredCandidates.length}`);
    assert(split.semanticFlowCandidates.length === 0, `expected no semanticflow arkmain candidates, got ${split.semanticFlowCandidates.length}`);
    assert(split.ineligibleCandidates.length === 2, `expected two ineligible arkmain candidates, got ${split.ineligibleCandidates.length}`);
    assert(split.kernelCoveredCandidates[0].methodName === "onCreate", "onCreate should be filtered as kernel-covered");
    assert(split.ineligibleCandidates.some(candidate => candidate.methodName === "loadContent"), "runtime-owner helper methods without override evidence should not be semanticflow arkmain candidates");
    assert(split.ineligibleCandidates.some(candidate => candidate.methodName === "onSave"), "component event handlers should not be modeled as formal ArkMain entries");
    const suppressedHelperSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.entry.restore",
        owner: "EntryAbility",
        surface: "restoringData",
        methodSignature: "@ets/entryability/EntryAbility.ets: EntryAbility.restoringData(Want, AbilityConstant.LaunchParam)",
        filePath: "ets/entryability/EntryAbility.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.entry.restore",
        round: 0,
        template: "owner-slot",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "restoringData(want: Want, launchParam: AbilityConstant.LaunchParam) {",
                "  AppStorage.setOrCreate<number>('currentZoneId', want.parameters['currentZoneId'] as number);",
                "  this.context.restoreWindowStage(this.storage);",
                "}",
            ].join("\n"),
        }],
    });
    assert(suppressedHelperSink?.reason === "ability_orchestration_helper_is_not_project_sink", "ability restoration helpers must not become generated project sinks");
    const preSuppressedHelper = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.entry.restore",
        owner: "EntryAbility",
        surface: "restoringData",
        methodSignature: "@ets/entryability/EntryAbility.ets: EntryAbility.restoringData(Want, AbilityConstant.LaunchParam)",
        filePath: "ets/entryability/EntryAbility.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        anchorId: "rule.entry.restore",
        round: 0,
        template: "owner-slot",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "restoringData(want: Want, launchParam: AbilityConstant.LaunchParam) {",
                "  AppStorage.setOrCreate<number>('currentZoneId', want.parameters['currentZoneId'] as number);",
                "  this.context.restoreWindowStage(this.storage);",
                "}",
            ].join("\n"),
        }],
    });
    assert(preSuppressedHelper?.reason === "ability_orchestration_helper_is_not_project_asset", "ability restoration helpers should be skipped before LLM modeling");
    const suppressedUiSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.index.changebar",
        owner: "Index",
        surface: "changeBar",
        methodSignature: "@ets/pages/Index.ets: Index.changeBar()",
        filePath: "ets/pages/Index.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "base", fieldPath: ["index"] }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.index.changebar",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "changeBar() {",
                "  if (this.index == 0) {",
                "    setSystemBar({ statusBarContentColor: '#ffffff' });",
                "  }",
                "}",
            ].join("\n"),
        }],
    });
    assert(suppressedUiSink?.reason === "ui_rendering_or_style_helper_is_not_project_sink", "UI style helpers must not become generated project sinks");
    const preSuppressedUi = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.index.changebar",
        owner: "Index",
        surface: "changeBar",
        methodSignature: "@ets/pages/Index.ets: Index.changeBar()",
        filePath: "ets/pages/Index.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        anchorId: "rule.index.changebar",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "changeBar() {",
                "  setSystemBar({ statusBarContentColor: '#000000' });",
                "}",
            ].join("\n"),
        }],
    });
    assert(preSuppressedUi?.reason === "ui_rendering_or_style_helper_is_not_project_asset", "UI style helpers should be skipped before LLM modeling");
    const suppressedPageDelegator = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.login.page-action",
        owner: "LoginCode",
        surface: "login",
        methodSignature: "@ets/pages/login/LoginCode.ets: LoginCode.login()",
        filePath: "ets/pages/login/LoginCode.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "base", fieldPath: ["phone"] }, { slot: "base", fieldPath: ["code"] }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.login.page-action",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "async login() {",
                "  const res = await loginApi(this.phone, this.code);",
                "  this.token = res.token;",
                "  router.back({ url: 'pages/Index' });",
                "}",
            ].join("\n"),
        }],
    });
    assert(suppressedPageDelegator?.reason === "page_action_delegator_is_not_project_sink", "page action delegators should not become duplicate generated project sinks");
    const preSuppressedPageDelegator = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.login.page-action",
        owner: "LoginCode",
        surface: "login",
        methodSignature: "@ets/pages/login/LoginCode.ets: LoginCode.login()",
        filePath: "ets/pages/login/LoginCode.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        anchorId: "rule.login.page-action",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: "async login() { const res = await loginApi(this.phone, this.code); this.token = res.token; }",
        }],
    });
    assert(preSuppressedPageDelegator?.reason === "page_action_delegator_is_not_project_asset", "page action delegators should be skipped before LLM modeling");
    const suppressedPageStorageHelper = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.person.save-desc",
        owner: "PersonInfo",
        surface: "saveUserDescription",
        methodSignature: "@ets/pages/PersonInfo.ets: PersonInfo.saveUserDescription(string)",
        filePath: "ets/pages/PersonInfo.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.person.save-desc",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "async saveUserDescription(value: string) {",
                "  this.userDescription = value;",
                "  await this.preferences.put('userDescription', value);",
                "}",
            ].join("\n"),
        }],
    });
    assert(suppressedPageStorageHelper?.reason === "page_controller_orchestration_is_not_project_sink", "page helpers that only delegate to official storage must not become project sinks");
    const preSuppressedPageStorageHelper = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.person.save-desc",
        owner: "PersonInfo",
        surface: "saveUserDescription",
        methodSignature: "@ets/pages/PersonInfo.ets: PersonInfo.saveUserDescription(string)",
        filePath: "ets/pages/PersonInfo.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        anchorId: "rule.person.save-desc",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: "async saveUserDescription(value: string) { this.userDescription = value; await this.preferences.put('userDescription', value); }",
        }],
    });
    assert(preSuppressedPageStorageHelper?.reason === "page_controller_orchestration_is_not_project_asset", "page storage helpers should be skipped before LLM modeling");
    const suppressedComponentActionSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.notes.create-folder",
        owner: "NoteAndCreateComp",
        surface: "onCreateConfirm",
        methodSignature: "@ets/components/FolderListComp.ets: NoteAndCreateComp.onCreateConfirm(string, string)",
        filePath: "ets/components/FolderListComp.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }, { slot: "arg", index: 1 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.notes.create-folder",
        round: 0,
        template: "multi-surface",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "onCreateConfirm(color: string, name: string) {",
                "  let folderData = new FolderData(uuid(), name, color);",
                "  this.AllFolderArray.push(folderData);",
                "  RdbStoreUtil.insert(TableName.FolderTable, folderData.toFolderObject(), null);",
                "  AppStorage.SetOrCreate('isUpdate', true);",
                "}",
            ].join("\n"),
        }],
    });
    assert(suppressedComponentActionSink?.reason === "page_controller_orchestration_is_not_project_sink", "component action methods that delegate to deeper database wrappers must not become project sinks");
    const preSuppressedComponentAction = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.notes.create-folder",
        owner: "NoteAndCreateComp",
        surface: "onCreateConfirm",
        methodSignature: "@ets/components/FolderListComp.ets: NoteAndCreateComp.onCreateConfirm(string, string)",
        filePath: "ets/components/FolderListComp.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        anchorId: "rule.notes.create-folder",
        round: 0,
        template: "multi-surface",
        observations: [],
        snippets: [{
            label: "method",
            code: "onCreateConfirm(color: string, name: string) { RdbStoreUtil.insert(TableName.FolderTable, new FolderData(uuid(), name, color).toFolderObject(), null); }",
        }],
    });
    assert(preSuppressedComponentAction?.reason === "page_controller_orchestration_is_not_project_asset", "component action methods should be skipped before LLM modeling when they only delegate to deeper wrappers");
    const preSuppressedPageStatePrep = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.psw.select",
        owner: "PswHomePage",
        surface: "selectListItem",
        methodSignature: "@ets/pages/PswManagement.ets: PswHomePage.selectListItem(DataEntity)",
        filePath: "ets/pages/PswManagement.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        anchorId: "rule.psw.select",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "selectListItem(item: DataEntity) {",
                "  this.newPassword = { name: item.name, content: item.content, timestamp: item.timestamp };",
                "  this.index = 0;",
                "}",
            ].join("\n"),
        }],
    });
    assert(preSuppressedPageStatePrep?.reason === "page_local_state_helper_is_not_project_asset", "page local state preparation should not become generated project assets");
    const suppressedPageStatePrepSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.psw.select",
        owner: "PswHomePage",
        surface: "selectListItem",
        methodSignature: "@ets/pages/PswManagement.ets: PswHomePage.selectListItem(DataEntity)",
        filePath: "ets/pages/PswManagement.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "medium",
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.psw.select",
        round: 0,
        template: "declarative-binding",
        observations: [],
        snippets: [{
            label: "method",
            code: "selectListItem(item: DataEntity) { this.newPassword = { name: item.name, content: item.content }; this.index = 0; }",
        }],
    });
    assert(suppressedPageStatePrepSink?.reason === "page_local_state_helper_is_not_project_sink", "page local state preparation should not become generated project sinks");
    const suppressedInternalRouterSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.router.push",
        owner: "AppRouterMgr",
        surface: "push",
        methodSignature: "@ets/router/manager.ets: AppRouterMgr.[static]push(HMRouterPathInfo, HMRouterPathCallback)",
        filePath: "ets/router/manager.ets",
        metaTags: ["rule", "candidate", "static"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.router.push",
        round: 0,
        template: "multi-surface",
        observations: [],
        snippets: [{
            label: "method",
            code: [
                "static async push(pathInfo: HMRouterPathInfo, callback?: HMRouterPathCallback) {",
                "  if (pathInfo && pathInfo.navigationId == undefined) {",
                "    pathInfo.navigationId = AppNav.root",
                "  }",
                "  if (pathInfo.pageUrl === AppRouter.webview) {",
                "    const param: IWebviewMeta = pathInfo.param = WebviewMgr.format(pathInfo.param) as Unknown",
                "    const stack: NavPathStack = HMRouterMgr.getPathStack(pathInfo.navigationId!) as Unknown",
                "    const params: IWebviewMeta[] = stack.getParamByName(AppRouter.webview) as Unknown",
                "  }",
                "  return HMRouterMgr.pushAsync(pathInfo, callback)",
                "}",
            ].join("\n"),
        }],
    });
    assert(suppressedInternalRouterSink?.reason === "internal_navigation_dispatch_is_not_project_sink", "internal page-stack navigation wrappers must not become generated project sinks");
    const preSuppressedInternalRouter = suppressKnownNonArtifactSemanticFlowCandidate({
        id: "rule.router.push",
        owner: "AppRouterMgr",
        surface: "push",
        methodSignature: "@ets/router/manager.ets: AppRouterMgr.[static]push(HMRouterPathInfo, HMRouterPathCallback)",
        filePath: "ets/router/manager.ets",
        metaTags: ["rule", "candidate", "static"],
    }, {
        anchorId: "rule.router.push",
        round: 0,
        template: "multi-surface",
        observations: [],
        snippets: [{
            label: "method",
            code: "static async push(pathInfo: HMRouterPathInfo, callback?: HMRouterPathCallback) { return HMRouterMgr.pushAsync(pathInfo, callback) }",
        }],
    });
    assert(preSuppressedInternalRouter?.reason === "internal_navigation_dispatch_is_not_project_asset", "internal page-stack navigation wrappers should be skipped before LLM modeling");
    const retainedDatabaseSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.db.insert",
        owner: "DatabaseManager",
        surface: "insertData",
        methodSignature: "@ets/components/database/Database.ets: DatabaseManager.insertData(string, InsertDataEntity)",
        filePath: "ets/components/database/Database.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 1 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.db.insert",
        round: 0,
        template: "multi-surface",
        observations: [],
        snippets: [{
            label: "method",
            code: "async insertData(table: string, data: InsertDataEntity) { await this.store.insert(table, data); }",
        }],
    });
    assert(!retainedDatabaseSink, "stable database wrappers outside page action code should remain eligible generated sinks");
    const rdbUpdateArtifact = buildSemanticFlowArtifact({
        id: "rule.rdb.update",
        owner: "RdbStoreUtil",
        surface: "update",
        methodSignature: "@ets/baseUtil/RdbStoreUtil.ets: RdbStoreUtil.update(relationalStore.ValuesBucket, relationalStore.RdbPredicates, Callback<number>|null)",
        filePath: "ets/baseUtil/RdbStoreUtil.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }, { slot: "arg", index: 1 }, { slot: "arg", index: 2 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule");
    const rdbUpdateTargets = ((rdbUpdateArtifact as any).ruleSet.sinks || []).map((rule: any) => String(rule.target));
    assert(rdbUpdateTargets.includes("arg0"), "RDB update wrapper should keep the values bucket as the generated sink target");
    assert(!rdbUpdateTargets.includes("arg1"), "RDB update wrapper must not generate a payload sink for RdbPredicates");
    assert(!rdbUpdateTargets.includes("arg2"), "RDB update wrapper must not generate a payload sink for callback/status slots");
    const databaseInsertArtifact = buildSemanticFlowArtifact({
        id: "rule.db.insert-data",
        owner: "DatabaseManager",
        surface: "insertData",
        methodSignature: "@ets/db/Database.ets: DatabaseManager.insertData(string, InsertDataEntity)",
        filePath: "ets/db/Database.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }, { slot: "arg", index: 1 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule");
    const databaseInsertTargets = ((databaseInsertArtifact as any).ruleSet.sinks || []).map((rule: any) => String(rule.target));
    assert(!databaseInsertTargets.includes("arg0"), "database insert wrapper must not treat leading table/key selectors as persisted payload");
    assert(databaseInsertTargets.includes("arg1"), "database insert wrapper should keep the record/entity payload target");
    const retainedLoggerSink = suppressInvalidResolvedSemanticFlowArtifact({
        id: "rule.logger.info",
        owner: "Logger",
        surface: "info",
        methodSignature: "@ets/common/utils/Logger.ets: Logger.info(string[])",
        filePath: "ets/common/utils/Logger.ets",
        metaTags: ["rule", "candidate", "static"],
    }, {
        confidence: "high",
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [],
        ruleKind: "sink",
        transfers: [],
    }, "rule", {
        anchorId: "rule.logger.info",
        round: 0,
        template: "owner-slot",
        observations: [],
        snippets: [{
            label: "method",
            code: "static info(...args: string[]) { hilog.info(0, 'tag', '%{public}s', args); }",
        }],
    });
    assert(!retainedLoggerSink, "real logging wrappers should remain eligible generated sinks");
    const arkItemA = buildSemanticFlowArkMainCandidateItem(arkCandidateA);
    const arkItemB = buildSemanticFlowArkMainCandidateItem(arkCandidateB);
    assert(arkItemA.anchor.id !== arkItemB.anchor.id, "arkmain anchor ids must stay unique across overload signatures");
    assert(arkItemA.initialSlice.snippets.some(snippet => snippet.label === "method"), "arkmain round0 should include method code snippet");
    assert(arkItemA.initialSlice.snippets.some(snippet => snippet.label === "owner-context"), "arkmain round0 should include owner context snippet");
    assert(!arkItemA.initialSlice.snippets.some(snippet => snippet.code.includes("owner_contract:")), "arkmain prompt slice must not leak owner signal tags");
    assert(!arkItemA.initialSlice.snippets.some(snippet => snippet.code.includes("framework_hint:")), "arkmain prompt slice must not leak framework hint tags");

    const expander = createArkMainCandidateExpander([arkCandidateA]);
    const deficit = {
        id: "def.arkmain.body",
        kind: "q_recv" as const,
        focus: {
            from: { slot: "arg" as const, index: 0 },
            carrierHint: "owner_slot",
        },
        scope: {
            owner: "DemoAbility",
            locality: "owner" as const,
            surface: "onCreate",
        },
        budgetClass: "owner_local" as const,
        why: ["need body evidence"],
        ask: "show owner context and body",
    };
    const plan = {
        kind: "q_recv" as const,
        seed: { mode: "owner" as const, value: "DemoAbility" },
        edges: ["E_recv", "E_scope"],
        budgetClass: "owner_local" as const,
        stopCondition: "receiver-write-or-scope-exhausted",
    };

    const expandedOnce = await expander.expand({
        anchor: arkItemA.anchor,
        draftId: "draft.arkmain.demoability.oncreate",
        slice: arkItemA.initialSlice,
        round: 0,
        deficit,
        plan,
        history: [],
    });
    const onceMethodBodyCount = expandedOnce.slice.snippets.filter(snippet => snippet.label === "method-body").length;
    const onceOwnerCount = expandedOnce.slice.snippets.filter(snippet => snippet.label === "owner-context").length;
    assert(onceMethodBodyCount === 1, `expected one method-body snippet after first expansion, got ${onceMethodBodyCount}`);
    assert(onceOwnerCount === 1, `expected one owner-context snippet after first expansion, got ${onceOwnerCount}`);
    assert(expandedOnce.delta.effective, "first arkmain expansion should be effective");

    const expandedTwice = await expander.expand({
        anchor: arkItemA.anchor,
        draftId: "draft.arkmain.demoability.oncreate",
        slice: expandedOnce.slice,
        round: 1,
        deficit,
        plan,
        history: [],
    });
    const twiceMethodBodyCount = expandedTwice.slice.snippets.filter(snippet => snippet.label === "method-body").length;
    const twiceOwnerCount = expandedTwice.slice.snippets.filter(snippet => snippet.label === "owner-context").length;
    assert(twiceMethodBodyCount === 1, `duplicate arkmain expansion must not append method-body twice, got ${twiceMethodBodyCount}`);
    assert(twiceOwnerCount === 1, `duplicate arkmain expansion must not append owner-context twice, got ${twiceOwnerCount}`);
    assert(!expandedTwice.delta.effective, "duplicate arkmain expansion should be a no-op delta");

    console.log("PASS testSemanticFlowGuards");
}

main().catch(error => {
    console.error("FAIL testSemanticFlowGuards");
    console.error(error);
    process.exit(1);
});
