import * as fs from "fs";
import * as path from "path";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../../core/model/callsite/callsiteContextSlices";
import { buildSemanticFlowApiModelingCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import {
    discoverApiCallbackModelingCandidates,
    discoverApiSurfaceModelingCandidates,
} from "../../core/semanticflow/ApiModelingCandidateScanner";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFile(filePath: string, lines: string[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

function main(): void {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_project_callback_candidates/latest");
    const sourceDir = "entry/src/main/ets";
    fs.rmSync(root, { recursive: true, force: true });

    writeFile(path.join(root, sourceDir, "component/PhoneInputField.ets"), [
        "import { IBestField } from 'ibestui';",
        "export struct PhoneInputField {",
        "  onPhoneChange: (value: string) => void = () => {};",
        "  build() {",
        "    IBestField({",
        "      value: '',",
        "      onChange: (value: string): void => {",
        "        this.onPhoneChange(`${value ?? ''}`);",
        "      }",
        "    });",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "view/LoginPage.ets"), [
        "import { IBestButton, IBestField } from 'ibestui';",
        "import { PhoneInputField } from '../component/PhoneInputField';",
        "export struct LoginPage {",
        "  build() {",
        "    TextInput({ text: '', onChange: (value: string) => this.ignore(value) });",
        "    IBestField({ value: '', onChange: (value: string) => this.vm.updateAccount(value) });",
        "    PhoneInputField({ onPhoneChange: (value: string) => this.vm.updatePhone(value) });",
        "    IBestButton({ text: 'login', onBtnClick: (): void => this.vm.login() });",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "configure/service.ets"), [
        "import Axios from '@ohos/axios';",
        "export class Servicer {",
        "  static async getUserCredential(code: string) {",
        "    const response = await Axios.post('https://oauth.example/token', { code });",
        "    return response.data;",
        "  }",
        "  static async getUserProfile(token: string) {",
        "    const response = await Axios.post('https://account.example/profile', { access_token: token });",
        "    return response.data;",
        "  }",
        "  async getParsedProfile(username: string) {",
        "    const raw = await this.http.get(`/users/${encodeURIComponent(username)}`);",
        "    const json = JSON.parse(raw);",
        "    const userVal = json['user'];",
        "    const parsedUser = User.fromJson(userVal);",
        "    return parsedUser;",
        "  }",
        "  async loginWithQRSession(token: string) {",
        "    const data = await this._post(`session_login/${token}`, '', true);",
        "    const restResult = RestResult.fromJson(data.result);",
        "    return restResult;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "configure/axios.ets"), [
        "import axios from '@ohos/axios';",
        "export function setupInterceptors(cacher: any) {",
        "  axios.interceptors.response.use((response: any) => {",
        "    cacher.cache(response);",
        "    return response.data;",
        "  }, (error: any) => {",
        "    cacher.logger(error);",
        "    return Promise.reject(error);",
        "  });",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "configure/requestUtil.ets"), [
        "import axios, { AxiosRequestConfig } from '@ohos/axios';",
        "const instance = axios.create({ timeout: 15000 });",
        "interface ApiResponse<T> { data: T }",
        "export const commonRequest = async<T>(config: AxiosRequestConfig): Promise<T> => {",
        "  const response = await instance.request(config) as ApiResponse<T>;",
        "  return response.data;",
        "};",
        "export class RequestClient {",
        "  async requestJson<T>(config: AxiosRequestConfig): Promise<T> {",
        "    const response = await instance.request(config) as ApiResponse<T>;",
        "    return response.data;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "generated-client/api/api-key-api.ts"), [
        "import type { AxiosPromise, RawAxiosRequestConfig } from '@ohos/axios';",
        "export class ApiKeyApi extends BaseAPI {",
        "  getKeys(options?: RawAxiosRequestConfig): AxiosPromise<KeyResult> {",
        "    return ApiKeyApiFp(this.configuration).getKeys(options).then((request) => request(this.axios, this.basePath));",
        "  }",
        "  getSessions(userId: string, options?: RawAxiosRequestConfig): AxiosPromise<SessionResult> {",
        "    return ApiKeyApiFp(this.configuration).getSessions(userId, options).then((request) => request(this.axios, this.basePath));",
        "  }",
        "  getDevices(userId: string, options?: RawAxiosRequestConfig): AxiosPromise<DeviceResult> {",
        "    return ApiKeyApiFp(this.configuration).getDevices(userId, options).then((request) => request(this.axios, this.basePath));",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "repository/TokenStoreRepository.ets"), [
        "export class TokenStoreRepository {",
        "  private dataSource: TokenStoreDataSource;",
        "  loadToken(): Promise<string> {",
        "    return this.dataSource.getToken();",
        "  }",
        "  saveToken(token: string): Promise<void> {",
        "    return this.dataSource.setToken(token);",
        "  }",
        "}",
        "export class CommonRepository {",
        "  private networkDataSource: CommonNetworkDataSource;",
        "  async getDictData(request: DictDataRequest): Promise<NetworkResponse<DictDataResponse>> {",
        "    return this.networkDataSource.getDictData(request);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "log/LoggerFacade.ets"), [
        "import hilog from '@ohos.hilog';",
        "export class Logger {",
        "  private static printer: any;",
        "  static d(...args: object[]) {",
        "    Logger.printer.d(...args);",
        "  }",
        "  static debug(config: object, ...args: object[]) {",
        "    Logger.printer.debug(config, ...args);",
        "  }",
        "  static getLogger(tag: string) {",
        "    return Logger.printerProxys.get(tag);",
        "  }",
        "  static addLogAdapter(adapter: object) {",
        "    Logger.printer.addLogAdapter(adapter);",
        "  }",
        "}",
        "export class LongLogAdapter {",
        "  logByCustomConfig(level: number, config: object, msg: string, ...args: object[]): void {",
        "    let newMsg = '';",
        ...Array.from({ length: 34 }, (_, index) => `    newMsg += 'prefix-${index}';`),
        "    msg.split('\\n').forEach((line) => {",
        "      newMsg += line;",
        "    });",
        "    this.realLog(level, 'tag', newMsg, 0x6666, ...args);",
        "  }",
        "  realLog(level: number, tag: string, msg: string, domain: number, ...args: object[]) {",
        "    hilog.info(domain, tag, '%{public}s', msg);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "bridge/BaseBridge.ts"), [
        "export class BaseBridge {",
        "  private controller: any;",
        "  call = (methodName: string, params: string): string => {",
        "    const method = Reflect.get(this, methodName);",
        "    const data = JSON.parse(params);",
        "    return JSON.stringify(method.call(this, data));",
        "  };",
        "  callHandler(method: string, args?: any[], cb?: OnReturnValue) {",
        "    this.controller.runJavaScript(`window.bridge(${JSON.stringify(args)})`);",
        "  }",
        "  registerJavaScriptProxy(object: object, name: string, methodList: string[]) {",
        "    this.controller.registerJavaScriptProxy(object, name, methodList);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "services/RemoteController.ets"), [
        "import Axios from '@ohos/axios';",
        "export class RemoteController {",
        "  async onRemoteRequest(payload: string) {",
        "    return Axios.post('https://api.example/remote', { payload });",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "database/app.ets"), [
        "import relationalStore from '@ohos.data.relationalStore';",
        "export interface IUser { uid?: string; name?: string | null }",
        "export class AppDatabaser {",
        "  static async updateUser(user?: IUser | null): Promise<IUser | null> {",
        "    const transaction = await db.createTransaction();",
        "    await transaction.execute('update AppUser set name = ? where uid = ?', [user?.name, user?.uid]);",
        "    return user ?? null;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "models/user.ets"), [
        "export interface IUser { uid?: string; name?: string | null; email?: string | null }",
        "export class User implements IUser {",
        "  uid: string = '';",
        "  name: string = '';",
        "  email: string = '';",
        "  static from(json: Partial<IUser>) {",
        "    const instance = new User();",
        "    instance.uid = json?.uid ?? '';",
        "    instance.name = json?.name ?? '';",
        "    instance.email = json?.email ?? '';",
        "    return instance;",
        "  }",
        "  public from(json: Partial<IUser>) {",
        "    const instance = new User();",
        "    instance.uid = json?.uid ?? this.uid;",
        "    instance.name = json?.name ?? this.name;",
        "    instance.email = json?.email ?? this.email;",
        "    return instance;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "pages/RegisterPage.ets"), [
        "export struct RegisterPage {",
        "  checkPhone() { return true; }",
        "  backRouteBuilder() { return undefined; }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "entryability/EntryAbility.ets"), [
        "import http from '@ohos.net.http';",
        "export class EntryAbility {",
        "  onCreate(want: Want) {",
        "    console.info('bootstrap');",
        "    http.request('https://example.com/bootstrap');",
        "  }",
        "  getSafeArea(windowStage: window.WindowStage) {",
        "    const mainWindow = windowStage.getMainWindowSync();",
        "    return mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "formability/UpdateByStatusFormAbility.ets"), [
        "import hilog from '@ohos.hilog';",
        "export class UpdateByStatusFormAbility {",
        "  onAddForm(want: Want) {",
        "    hilog.info(0, 'form', 'add form');",
        "    return {};",
        "  }",
        "  onUpdateForm(formId: string) {",
        "    hilog.info(0, 'form', formId);",
        "  }",
        "  onFormEvent(formId: string, message: string) {",
        "    hilog.info(0, 'form', message);",
        "  }",
        "  onCastToNormalForm(formId: string) {",
        "    hilog.info(0, 'form', formId);",
        "  }",
        "  onRemoveForm(formId: string) {",
        "    hilog.info(0, 'form', formId);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "MainAbility/BluetoothAbility.ets"), [
        "import hilog from '@ohos.hilog';",
        "export class BluetoothAbility {",
        "  onSessionCreate(want: Want, session: UIExtensionContentSession) {",
        "    hilog.info(0, 'session', 'create');",
        "  }",
        "  onSessionDestroy(session: UIExtensionContentSession) {",
        "    hilog.info(0, 'session', 'destroy');",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "ServiceExt/ServiceExtAbility.ts"), [
        "import hilog from '@ohos.hilog';",
        "export class ServiceExtAbility {",
        "  onRequest(want: Want, startId: number) {",
        "    hilog.info(0, 'service', String(startId));",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "rpc/RemoteStub.ets"), [
        "import hilog from '@ohos.hilog';",
        "export class RemoteStub {",
        "  onRemoteRequest(code: number, data: rpc.MessageSequence, reply: rpc.MessageSequence) {",
        "    hilog.info(0, 'rpc', String(code));",
        "    return true;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "idl/IdlServiceExtStub.ts"), [
        "import hilog from '@ohos.hilog';",
        "export class IdlServiceExtStub {",
        "  onRemoteMessageRequest(code: number, data: rpc.MessageSequence, reply: rpc.MessageSequence) {",
        "    hilog.info(0, 'rpc', String(code));",
        "    return true;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "api/sdk.d.ts"), [
        "export function get(path: string): Promise<string>;",
        "export function post(path: string, value: string): Promise<void>;",
    ]);
    writeFile(path.join(root, sourceDir, "api/arkts-sdk.d.ets"), [
        "export function request(path: string): Promise<string>;",
    ]);

    const candidates = discoverApiCallbackModelingCandidates(root, [sourceDir], {
        maxCandidates: 20,
    });
    const methods = new Set(candidates.map(item => item.method));
    assert(methods.has("IBestField"), "third-party field callback should become a recalled modeling candidate");
    assert(methods.has("PhoneInputField"), "project wrapper callback should become a recalled modeling candidate");
    assert(methods.has("IBestButton"), "third-party action callback should become a recalled modeling candidate");
    assert(!methods.has("TextInput"), "official ArkUI TextInput callback should not be sent to project LLM modeling");

    const phoneCandidate = candidates.find(item => item.method === "PhoneInputField");
    assert(phoneCandidate, "missing PhoneInputField candidate");
    assert(String(phoneCandidate.sourceFile).endsWith("component/PhoneInputField.ets"), `project component candidate should resolve callee source file, got ${phoneCandidate.sourceFile}`);
    assert(Array.isArray((phoneCandidate as any).contextSlices) && (phoneCandidate as any).contextSlices.length > 0, "recalled candidates should include source callsite slices");

    const enriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: root,
        sourceDirs: [sourceDir],
        items: [phoneCandidate],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 2,
        cfgNeighborRadius: 1,
    });
    assert(Array.isArray((enriched[0] as any).contextSlices) && (enriched[0] as any).contextSlices.length > 0, "enrichment should preserve recalled context slices");

    const item = buildSemanticFlowApiModelingCandidateItem(enriched[0]);
    assert(item.initialSlice.observations.includes("candidateOrigin=recall_callback_surface"), "prompt observations should expose recall origin");
    assert(!(item.anchor.metaTags || []).includes("rule"), "API modeling candidates must not be pre-tagged as rule artifacts");
    assert(item.initialSlice.observations.some(line => line.includes("callbackProperties=onPhoneChange")), "prompt observations should expose callback property names");

    const methodCallbackCandidate = candidates.find(item =>
        item.method === "use"
        && (item as any).candidateOrigin === "recall_method_callback_surface"
        && String(item.sourceFile).endsWith("configure/axios.ets"));
    assert(methodCallbackCandidate, "third-party method-style callback registration should become a recalled modeling candidate");
    assert((methodCallbackCandidate as any).callbackArgIndexes?.includes(0), "method-style callback candidate should expose callback argument index 0");
    assert((methodCallbackCandidate as any).callbackArgIndexes?.includes(1), "method-style callback candidate should expose callback argument index 1");
    assert((methodCallbackCandidate as any).typeHint === "interceptors.response", `method-style callback candidate should carry a stable receiver-specific typeHint, got ${(methodCallbackCandidate as any).typeHint}`);
    const methodCallbackItem = buildSemanticFlowApiModelingCandidateItem(methodCallbackCandidate);
    assert(methodCallbackItem.initialSlice.observations.some(line => line.includes("callbackArgIndexes=0,1")), "prompt observations should expose method callback argument indexes");
    assert(methodCallbackItem.initialSlice.observations.some(line => line.includes("typeHint=interceptors.response")), "prompt observations should expose method callback type hint");

    const apiCandidates = discoverApiSurfaceModelingCandidates(root, [sourceDir], {
        maxCandidates: 80,
    });
    const apiMethods = new Set(apiCandidates.map(item => item.method));
    assert(apiMethods.has("getUserCredential"), "service wrapper that exchanges auth code through Axios should become a recalled API modeling candidate");
    assert(apiMethods.has("getUserProfile"), "service wrapper that sends access token through Axios should become a recalled API modeling candidate");
    assert(!apiMethods.has("checkPhone"), "page validation helper should not become a recalled API wrapper candidate");
    const credentialCandidate = apiCandidates.find(item =>
        item.method === "getUserCredential" && (item as any).candidateOrigin === "recall_api_surface");
    assert(credentialCandidate, "missing getUserCredential recalled API candidate");
    assert((credentialCandidate as any).candidateOrigin === "recall_api_surface", "API surface candidate should expose neutral recall origin");
    assert(typeof (credentialCandidate as any).methodSnippet === "string" && (credentialCandidate as any).methodSnippet.includes("Axios.post"), "API wrapper candidate should carry method body evidence");
    const credentialSourceCandidate = apiCandidates.find(item =>
        item.method === "getUserCredential" && (item as any).semanticFocus === "returned_value_surface");
    assert(credentialSourceCandidate, "network wrapper that returns response data should also expose a focused return-source candidate");
    const credentialSourceItem = buildSemanticFlowApiModelingCandidateItem(credentialSourceCandidate);
    assert(credentialSourceItem.initialSlice.observations.includes("semanticFocus=returned_value_surface"), "focused returned-value candidate should expose semanticFocus to the LLM");
    assert((credentialSourceItem.anchor.metaTags || []).includes("focus-returned_value_surface"), "focused returned-value candidate should get a distinct anchor tag");
    assert((credentialSourceItem.initialSlice.notes || []).some(note => note.includes("not as a preselected source rule")), "focused return-source candidate must not preselect the artifact plane");
    for (const methodName of ["commonRequest", "requestJson"]) {
        const genericCandidate = apiCandidates.find(item =>
            item.method === methodName && String(item.sourceFile).endsWith("configure/requestUtil.ets"));
        assert(genericCandidate, `${methodName} should be recalled when declared with a TypeScript generic parameter`);
        const genericFocusedCandidate = apiCandidates.find(item =>
            item.method === methodName
            && String(item.sourceFile).endsWith("configure/requestUtil.ets")
            && (item as any).semanticFocus === "returned_value_surface");
        assert(genericFocusedCandidate, `${methodName} should expose a returned-value modeling question`);
    }
    for (const methodName of ["getParsedProfile", "loginWithQRSession"]) {
        const focusedCandidate = apiCandidates.find(item =>
            item.method === methodName && (item as any).semanticFocus === "returned_value_surface");
        assert(focusedCandidate, `${methodName} should expose a focused return-source candidate even when the response is parsed or converted before return`);
    }
    const generatedApiBudgetCandidates = discoverApiSurfaceModelingCandidates(root, [`${sourceDir}/generated-client/api`], {
        maxCandidates: 4,
    });
    const generatedApiGrouped = new Map<string, Set<string>>();
    for (const item of generatedApiBudgetCandidates) {
        const key = `${item.sourceFile}:${item.method}`;
        const group = generatedApiGrouped.get(key) || new Set<string>();
        group.add((item as any).semanticFocus === "returned_value_surface" ? "returned" : "ordinary");
        generatedApiGrouped.set(key, group);
    }
    assert([...generatedApiGrouped.values()].some(group => group.has("ordinary") && group.has("returned")),
        "candidate scanner maxCandidates truncation should preserve ordinary and returned-value questions for generated SDK API surfaces");
    for (const methodName of ["loadToken", "getDictData"]) {
        const focusedCandidate = apiCandidates.find(item =>
            item.method === methodName
            && String(item.sourceFile).endsWith("repository/TokenStoreRepository.ets")
            && (item as any).semanticFocus === "returned_value_surface");
        assert(focusedCandidate, `${methodName} should expose a neutral returned-value modeling question when a repository delegates to a data source`);
    }
    const saveTokenReturnCandidate = apiCandidates.find(item =>
        item.method === "saveToken"
        && String(item.sourceFile).endsWith("repository/TokenStoreRepository.ets")
        && (item as any).semanticFocus === "returned_value_surface");
    assert(!saveTokenReturnCandidate, "void-like repository writers should not create returned-value modeling questions");
    const loggerPayloadIndex = apiCandidates.findIndex(item =>
        item.method === "d" && String(item.sourceFile).endsWith("log/LoggerFacade.ets"));
    const loggerFactoryIndex = apiCandidates.findIndex(item =>
        item.method === "getLogger" && String(item.sourceFile).endsWith("log/LoggerFacade.ets"));
    assert(loggerPayloadIndex >= 0, "public logging payload facade should become a recalled API candidate");
    assert(loggerFactoryIndex < 0 || loggerPayloadIndex < loggerFactoryIndex,
        "logging payload methods should not be outranked by logger factory/cache helpers");
    const longLogCandidate = apiCandidates.find(item =>
        item.method === "logByCustomConfig" && String(item.sourceFile).endsWith("log/LoggerFacade.ets"));
    assert(longLogCandidate, "long logging wrapper should be recalled");
    const longLogItem = buildSemanticFlowApiModelingCandidateItem(longLogCandidate, {
        companionCandidates: apiCandidates,
    });
    const longLogEvidence = longLogItem.initialSlice.snippets.map(snippet => snippet.code || "").join("\n");
    assert(longLogEvidence.includes("this.realLog"),
        "long method evidence should retain downstream logging boundary calls after compaction");
    assert(longLogEvidence.includes("hilog.info"),
        "same-file companion evidence should retain official logging sink calls after compaction");
    assert(longLogEvidence.includes("companionFinalSinkUsage=realLog") && longLogEvidence.includes("unused:arg0(level),arg4(args)"),
        "same-file companion evidence should expose final official sink parameter usage");
    const remoteControllerCandidate = apiCandidates.find(item =>
        item.method === "onRemoteRequest" && String(item.sourceFile).endsWith("services/RemoteController.ets"));
    assert(remoteControllerCandidate, "project service methods should not be excluded only because the owner contains Remote");
    const updateUserCandidate = apiCandidates.find(item =>
        item.method === "updateUser" && String(item.sourceFile).endsWith("database/app.ets"));
    assert(updateUserCandidate, "database wrapper with optional parameter should become a recalled API candidate");
    assert(updateUserCandidate.argCount === 1, `optional TypeScript parameter should count as one argument, got ${updateUserCandidate.argCount}`);
    assert(String(updateUserCandidate.callee_signature).includes("updateUser(Unknown)"), `optional parameter should appear in generated signature, got ${updateUserCandidate.callee_signature}`);
    const userFromCandidates = apiCandidates.filter(item =>
        item.method === "from" && String(item.sourceFile).endsWith("models/user.ets"));
    assert(userFromCandidates.length >= 2, `model mapper static/instance from methods should become recalled candidates, got ${userFromCandidates.length}`);
    assert(userFromCandidates.every(item => item.argCount === 1), "model mapper candidates should preserve one payload parameter");
    for (const methodName of ["call", "callHandler", "registerJavaScriptProxy"]) {
        const bridgeCandidate = apiCandidates.find(item =>
            item.method === methodName && String(item.sourceFile).endsWith("bridge/BaseBridge.ts"));
        assert(bridgeCandidate, `${methodName} should be recalled from WebView/JSBridge interop code`);
        assert((bridgeCandidate.topEntries || []).includes("candidateBoundary=project_or_third_party_bridge_evidence"),
            `${methodName} should carry bridge evidence instead of a preselected artifact plane`);
    }
    const bridgeCallCandidate = apiCandidates.find(item =>
        item.method === "call" && String(item.sourceFile).endsWith("bridge/BaseBridge.ts"));
    assert(bridgeCallCandidate, "missing bridge call candidate");
    const bridgeCallItem = buildSemanticFlowApiModelingCandidateItem(bridgeCallCandidate, {
        companionCandidates: apiCandidates,
    });
    assert(bridgeCallItem.anchor.id.startsWith("api-modeling."),
        `API modeling candidates must use a neutral anchor prefix, got ${bridgeCallItem.anchor.id}`);
    assert(!bridgeCallItem.anchor.id.startsWith("rule."),
        `API modeling candidates must not preselect the rules plane in anchor id: ${bridgeCallItem.anchor.id}`);
    assert(bridgeCallItem.initialSlice.template === "multi-surface",
        `bridge dispatch candidates should use multi-surface evidence, got ${bridgeCallItem.initialSlice.template}`);
    assert(bridgeCallItem.initialSlice.observations.includes("bridgeEvidence=reflect_dispatch"),
        "bridge dispatch candidates should expose neutral Reflect dispatch evidence");
    assert(bridgeCallItem.initialSlice.observations.includes("bridgeEvidence=json_parse_boundary_input"),
        "bridge dispatch candidates should expose neutral JSON boundary-input evidence");
    assert((bridgeCallItem.initialSlice.notes || []).some(note => note.includes("not a preselected module or rule")),
        "bridge candidates must not preselect the artifact plane");
    assert(bridgeCallItem.initialSlice.snippets.some(snippet => snippet.label === "method-bridge-evidence"),
        "bridge candidates should provide compact bridge-focused method evidence");
    assert(bridgeCallItem.initialSlice.snippets.some(snippet => snippet.label === "bridge-companion-registerJavaScriptProxy"),
        "bridge candidates should prioritize registration companion evidence");
    const bridgeReturnedValueCandidate = apiCandidates.find(item =>
        item.method === "call"
        && String(item.sourceFile).endsWith("bridge/BaseBridge.ts")
        && (item as any).semanticFocus === "returned_value_surface");
    assert(!bridgeReturnedValueCandidate, "Map/Reflect-style bridge get calls must not be mistaken for external response return candidates");
    assert(!apiMethods.has("get") && !apiMethods.has("post") && !apiMethods.has("request"), "declaration-only .d.ts/.d.ets APIs must not become recalled API modeling candidates");
    for (const entryName of ["onCreate", "onAddForm", "onUpdateForm", "onFormEvent", "onCastToNormalForm", "onRemoveForm", "onSessionCreate", "onSessionDestroy", "onRequest"]) {
        const candidate = apiCandidates.find(item => item.method === entryName);
        if (candidate) {
            assert((candidate.topEntries || []).includes("candidateBoundary=official_arkmain_entry_evidence"),
                `${entryName} must be marked as official ArkMain evidence when recalled`);
            const item = buildSemanticFlowApiModelingCandidateItem(candidate);
            assert(item.anchor.arkMainSelector?.methodName === entryName,
                `${entryName} official evidence should carry an ArkMain selector when sent to the LLM`);
        }
    }
    const safeAreaCandidate = apiCandidates.find(item => item.method === "getSafeArea");
    if (safeAreaCandidate) {
        assert((safeAreaCandidate.topEntries || []).includes("candidateBoundary=framework_context_helper_evidence"),
            "Ability window/safe-area helpers must be marked as framework context helper evidence when recalled");
    }
    const rpcCandidate = apiCandidates.find(item =>
        item.method === "onRemoteRequest" && String(item.sourceFile).endsWith("rpc/RemoteStub.ets"));
    if (rpcCandidate) {
        assert((rpcCandidate.topEntries || []).includes("candidateBoundary=official_arkmain_entry_evidence"),
            "RPC remote request entries must carry official ArkMain evidence when recalled");
    }
    const idlCandidate = apiCandidates.find(item =>
        item.method === "onRemoteMessageRequest" && String(item.sourceFile).endsWith("idl/IdlServiceExtStub.ts"));
    if (idlCandidate) {
        assert((idlCandidate.topEntries || []).includes("candidateBoundary=official_arkmain_entry_evidence"),
            "IDL remote message request entries must carry official ArkMain evidence when recalled");
    }

    console.log("PASS test_semanticflow_project_callback_candidates");
}

main();
