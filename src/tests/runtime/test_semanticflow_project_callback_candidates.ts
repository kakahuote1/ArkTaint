import * as fs from "fs";
import * as path from "path";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../../core/model/callsite/callsiteContextSlices";
import { buildSemanticFlowApiModelingCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import {
    discoverApiCallbackModelingCandidates,
    discoverApiSurfaceModelingCandidates,
} from "../../core/semanticflow/ApiModelingCandidateScanner";
import {
    selectSemanticFlowRuleCandidatesForModeling,
    semanticFlowCandidateBelongsToSourceDir,
} from "../../cli/semanticflow";

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
    writeFile(path.join(root, sourceDir, "pages/MqttPage.ets"), [
        "import { MqttAsyncClient, MqttPublishOptions } from '@thirdparty/mqtt';",
        "export struct MqttPage {",
        "  private client: MqttAsyncClient = new MqttAsyncClient();",
        "  @State keyboardStr: string = '';",
        "  onSubmit() {",
        "    this.publish('chat', this.keyboardStr);",
        "  }",
        "  publish(topic: string, payload: string) {",
        "    const publishOption: MqttPublishOptions = {",
        "      topic,",
        "      payload,",
        "      qos: 1,",
        "    };",
        "    this.client.publish(publishOption);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "pages/LocalOnlyPage.ets"), [
        "class LocalPublisher {",
        "  publish(payload: string) {",
        "    this.lastPayload = payload;",
        "  }",
        "}",
        "export struct LocalOnlyPage {",
        "  private local: LocalPublisher = new LocalPublisher();",
        "  @State text: string = '';",
        "  onSubmit() {",
        "    this.local.publish(this.text);",
        "  }",
        "  formatLocal(",
        "    value: string",
        "  ): string {",
        "    return value.trim();",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "pages/StaticStoragePage.ets"), [
        "import { StoreUtil } from 'third-party-store';",
        "import { OpaqueRelay } from 'opaque-vendor-kit';",
        "import { ProjectKvStore } from '../utils/ProjectKvStore';",
        "import { LocalHelper } from '../utils/LocalHelper';",
        "import { DeviceInfo } from '@kit.BasicServicesKit';",
        "export struct StaticStoragePage {",
        "  private relay: OpaqueRelay = new OpaqueRelay();",
        "  async loadSecret() {",
        "    this.password = await StoreUtil.getData('account_password');",
        "    await StoreUtil.putData('account_password', this.password);",
        "    this.token = await ProjectKvStore.getData('session_token');",
        "    await ProjectKvStore.putData('session_token', this.token);",
        "    this.relay.perform(this.password);",
        "    const display = LocalHelper.getData('display_name');",
        "    const status = StoreUtil.getStatus('theme');",
        "    const version = DeviceInfo.getData('device_version');",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "utils/ProjectKvStore.ets"), [
        "export class ProjectKvStore {",
        "  static async getData(key: string): Promise<string> {",
        "    return await preferences.getSync(key, '');",
        "  }",
        "  static async putData(key: string, value: string): Promise<void> {",
        "    await preferences.putSync(key, value);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "utils/LocalHelper.ets"), [
        "export class LocalHelper {",
        "  static getData(key: string): string {",
        "    return key.trim();",
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
    writeFile(path.join(root, sourceDir, "network/MultiLinePrivateClient.ets"), [
        "import { rcp } from '@kit.RemoteCommunicationKit';",
        "export class MultiLinePrivateClient {",
        "  private authHeaders: rcp.RequestHeaders = {};",
        "  async propfind(path: string, headers?: rcp.RequestHeaders): Promise<void> {",
        "    const finalHeaders: rcp.RequestHeaders = {};",
        "    if (headers) {",
        "      Object.assign(finalHeaders, headers);",
        "    }",
        "    await this._request(",
        "      'PROPFIND',",
        "      path,",
        "      finalHeaders",
        "    );",
        "  }",
        "  async _request(",
        "    method: string,",
        "    path: string,",
        "    headers?: rcp.RequestHeaders",
        "  ): Promise<void> {",
        "    const mergedHeaders: rcp.RequestHeaders = {};",
        "    Object.assign(mergedHeaders, this.authHeaders);",
        "    Object.assign(mergedHeaders, headers);",
        "    console.debug('request headers', JSON.stringify(mergedHeaders));",
        "    await new rcp.Session().fetch(new rcp.Request(path, method, mergedHeaders));",
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
    writeFile(path.join(root, sourceDir, "HybridContainer/DMPWebViewProxy.ets"), [
        "import { DMPChannelProxyNext } from '../Service/DMPChannelProxyNext';",
        "import { DMPMap } from '../Utils/DMPMap';",
        "interface Message {",
        "  type: string;",
        "  body: object;",
        "  target: string;",
        "}",
        "export class DMPWebViewProxy {",
        "  webViewId: number = 0;",
        "  invoke(msg: Message) {",
        "    return DMPChannelProxyNext.messageHandlerNext(msg.type, DMPMap.createFromObject(msg.body), msg.target);",
        "  }",
        "  getWebViewId() {",
        "    return this.webViewId;",
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
    writeFile(path.join(root, sourceDir, "viewmodels/MessageViewModel.ets"), [
        "import { ChatClient, ChatMessage, ChatType } from '@thirdparty/chat-sdk';",
        "export interface MessageContent { value?: string }",
        "export class BaseMessageViewModel {",
        "  sendTextMessage(content?: MessageContent) {}",
        "  sendMessage(message: ChatMessage | undefined) {}",
        "}",
        "export class UnrelatedBase {",
        "  sendTextMessage(content?: MessageContent) {}",
        "}",
        "export class MessageViewModel extends BaseMessageViewModel {",
        "  conversationId: string = '';",
        "  override sendTextMessage(content?: MessageContent) {",
        "    if (!content || !content.value) { return; }",
        "    const message = ChatMessage.createTextSendMessage(this.conversationId, content.value);",
        "    this.sendMessage(message);",
        "  }",
        "  override sendMessage(message: ChatMessage | undefined) {",
        "    ChatClient.getInstance().chatManager()?.sendMessage(message);",
        "  }",
        "  scrollToLatest() {",
        "    this.listScroller.scrollToIndex(0);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "components/chat/ChatView.ets"), [
        "import { ChatInputMenuView } from './ChatComponents';",
        "import { BaseMessageViewModel, MessageViewModel, MessageContent, UnrelatedBase } from '../../viewmodels/MessageViewModel';",
        "export struct ChatView {",
        "  @Param messageViewModel: BaseMessageViewModel = new MessageViewModel();",
        "  @State unrelatedVm: UnrelatedBase = new MessageViewModel();",
        "  build() {",
        "    ChatInputMenuView({",
        "      onClickSend: (content: MessageContent) => {",
        "        this.messageViewModel.sendTextMessage(content);",
        "        this.unrelatedVm.sendTextMessage(content);",
        "      },",
        "      onClickText: () => {}",
        "    });",
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
    writeFile(path.join(root, sourceDir, "common/EventHub.ets"), [
        "import { emitter } from '@kit.BasicServicesKit';",
        "export enum EventKey {",
        "  LoginWebDav = 10019,",
        "  Other = 10020,",
        "}",
        "export class EventHub {",
        "  static sendEvent(key: EventKey, data: any = null) {",
        "    emitter.emit({ eventId: key }, { data: data });",
        "  }",
        "  static on(key: EventKey, callback: (data: any) => void, once: boolean = true) {",
        "    if (once) {",
        "      emitter.off(key);",
        "    }",
        "    emitter.on({ eventId: key }, (data) => {",
        "      callback(data.data);",
        "    });",
        "  }",
        "  static off(key: EventKey) {",
        "    emitter.off(key);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "pages/EventHubWebDavPage.ets"), [
        "import { EventHub, EventKey } from '../common/EventHub';",
        "class WebDavClient {",
        "  constructor(config: any) {}",
        "}",
        "export struct EventHubWebDavPage {",
        "  @StorageLink('Password') password: string = '';",
        "  aboutToAppear() {",
        "    EventHub.on(EventKey.LoginWebDav, async (showToast: boolean = false) => {",
        "      const config = { password: this.password };",
        "      new WebDavClient(config);",
        "    });",
        "  }",
        "  login() {",
        "    EventHub.sendEvent(EventKey.LoginWebDav, true);",
        "  }",
        "  other() {",
        "    EventHub.sendEvent(EventKey.Other, true);",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, "features/home/oh-package.json5"), [
        "{",
        "  \"name\": \"home\",",
        "  \"dependencies\": {",
        "    \"@itcast/basic\": \"file:../../commons/basic\"",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, "commons/basic/oh-package.json5"), [
        "{",
        "  \"name\": \"@itcast/basic\",",
        "  \"main\": \"Index.ets\"",
        "}",
    ]);
    writeFile(path.join(root, "commons/basic/Index.ets"), [
        "export { HdWeb } from './src/main/ets/components/HdWeb';",
    ]);
    writeFile(path.join(root, "commons/basic/src/main/ets/components/HdWeb.ets"), [
        "export struct HdWeb {",
        "  onLoad: () => void = () => {};",
        "  build() {",
        "    Web({ src: $rawfile('detail.html') })",
        "      .onPageEnd(() => {",
        "        this.onLoad();",
        "      });",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, "features/home/src/main/ets/views/QuestionDetailComp.ets"), [
        "import { HdWeb } from '@itcast/basic';",
        "export struct QuestionDetailComp {",
        "  build() {",
        "    HdWeb({",
        "      onLoad: () => {",
        "        this.webController.runJavaScript(`writeContent(${this.item.answer})`);",
        "      }",
        "    });",
        "  }",
        "}",
    ]);

    const candidates = discoverApiCallbackModelingCandidates(root, [sourceDir, "features/home/src/main/ets"], {
        maxCandidates: 40,
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
    const hdWebCandidate = candidates.find(item => item.method === "HdWeb");
    assert(hdWebCandidate, "local package re-exported component callback should become a recalled modeling candidate");
    assert(
        String(hdWebCandidate.sourceFile).endsWith("commons/basic/src/main/ets/components/HdWeb.ets"),
        `package callback candidate should resolve re-exported component owner file, got ${hdWebCandidate.sourceFile}`,
    );
    assert(
        String(hdWebCandidate.callee_signature).includes("commons/basic/src/main/ets/components/HdWeb.ets"),
        `package callback candidate should carry stable owner signature, got ${hdWebCandidate.callee_signature}`,
    );
    assert(
        ((hdWebCandidate as any).topEntries || []).some((entry: string) => entry.includes("callbackOwnerResolved=true")),
        "resolved package callback candidate should expose callback owner evidence",
    );
    assert(
        String((hdWebCandidate as any).methodSnippet || "").includes("this.onLoad"),
        "resolved package callback candidate should include owner callback invocation evidence",
    );
    const hdWebSelection = selectSemanticFlowRuleCandidatesForModeling([hdWebCandidate] as any, 1);
    assert(hdWebSelection.length === 1 && hdWebSelection[0] === hdWebCandidate, "resolved lifecycle callback owner should be selected for SemanticFlow modeling");
    assert(
        semanticFlowCandidateBelongsToSourceDir(
            "features/home/src/main/ets",
            path.join(root, "features/home/src/main/ets"),
            hdWebCandidate,
        ),
        "source-dir scoping should keep package-owned callback candidates when their callsite belongs to the active sourceDir",
    );

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

    const eventHubCallbackCandidate = candidates.find(item =>
        item.method === "on"
        && String(item.sourceFile).endsWith("common/EventHub.ets")
        && ((item as any).topEntries || []).some((entry: string) => entry === "receiver=EventHub")
        && (item as any).candidateOrigin === "recall_method_callback_surface");
    assert(eventHubCallbackCandidate, "project event-bus callback registration should resolve to the imported receiver implementation file");
    assert((eventHubCallbackCandidate as any).callbackArgIndexes?.includes(1), "EventHub.on candidate should expose callback argument index 1");
    assert((eventHubCallbackCandidate as any).methodSnippetSource === "recall_method_callback_receiver_import", "EventHub.on candidate should carry imported receiver method evidence");
    assert(String((eventHubCallbackCandidate as any).methodSnippet || "").includes("emitter.on"), "EventHub.on candidate should include registration implementation evidence");

    const apiCandidates = discoverApiSurfaceModelingCandidates(root, [sourceDir], {
        maxCandidates: 120,
    });
    const apiMethods = new Set(apiCandidates.map(item => item.method));
    assert(apiMethods.has("getUserCredential"), "service wrapper that exchanges auth code through Axios should become a recalled API modeling candidate");
    assert(apiMethods.has("getUserProfile"), "service wrapper that sends access token through Axios should become a recalled API modeling candidate");
    const directMqttPublishCandidate = apiCandidates.find(item =>
        item.method === "publish"
        && String(item.sourceFile).endsWith("pages/MqttPage.ets")
        && (item as any).candidateOrigin === "recall_direct_boundary_surface");
    const pageMqttPublishWrapperCandidate = apiCandidates.find(item =>
        item.method === "publish"
        && String(item.sourceFile).endsWith("pages/MqttPage.ets")
        && (item as any).candidateOrigin === "recall_api_surface");
    assert(pageMqttPublishWrapperCandidate, "page-local methods with visible SDK-boundary payload forwarding should become project API wrapper candidates");
    assert(
        ((pageMqttPublishWrapperCandidate as any).topEntries || []).some((entry: string) => entry.includes("candidateBoundary=page_local_project_or_third_party_wrapper_evidence")),
        "page-local project wrapper candidates should expose page-local boundary evidence to the LLM",
    );
    assert(directMqttPublishCandidate, "page-local direct SDK boundary calls with typed receiver evidence should become API modeling candidates");
    assert(
        String(directMqttPublishCandidate.callee_signature).includes("MqttAsyncClient.publish"),
        `direct SDK boundary candidate should use typed receiver owner, got ${directMqttPublishCandidate.callee_signature}`,
    );
    assert(
        ((directMqttPublishCandidate as any).topEntries || []).some((entry: string) => entry.includes("candidateBoundary=direct_project_or_third_party_callsite_evidence")),
        "direct SDK boundary candidate should expose callsite boundary evidence",
    );
    assert(
        !apiCandidates.some(item =>
            item.method === "publish"
            && String(item.sourceFile).endsWith("pages/LocalOnlyPage.ets")
            && (item as any).candidateOrigin === "recall_direct_boundary_surface"),
        "same-name local helper calls without external/imported boundary evidence must not become direct SDK boundary candidates",
    );
    const staticStoreReadCandidate = apiCandidates.find(item =>
        item.method === "getData"
        && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
        && String(item.callee_signature).includes("StoreUtil.getData")
        && (item as any).candidateOrigin === "recall_direct_boundary_surface");
    assert(staticStoreReadCandidate, "external named-import utility calls with payload/key evidence should become direct boundary candidates");
    assert(staticStoreReadCandidate.invokeKind === "any", `source-text imported-owner direct boundary candidate should use unresolved any invokeKind, got ${staticStoreReadCandidate.invokeKind}`);
    assert(
        String(staticStoreReadCandidate.callee_signature).includes("StoreUtil.getData"),
        `direct boundary candidate should preserve imported owner syntax as candidate evidence, got ${staticStoreReadCandidate.callee_signature}`,
    );
    assert(
        ((staticStoreReadCandidate as any).topEntries || []).some((entry: string) => entry.includes("directBoundaryNamespaceOwnerCallsite=true")),
        "source-text imported-owner boundary candidate should expose namespace owner callsite evidence",
    );
    const officialDeviceCandidate = apiCandidates.find(item =>
        item.method === "getData"
        && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
        && String((item as any).importSource || "").includes("@kit"));
    assert(officialDeviceCandidate, "official imported calls should be recalled structurally; dynamic asset coverage is responsible for known-official filtering");
    const staticStoreStatusCandidate = apiCandidates.find(item =>
        item.method === "getStatus"
        && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
        && (item as any).candidateOrigin === "recall_direct_boundary_surface");
    assert(staticStoreStatusCandidate, "external static utility calls should be recalled without a method-name whitelist");
    const opaqueRelayCandidate = apiCandidates.find(item =>
        item.method === "perform"
        && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
        && String(item.callee_signature).includes("OpaqueRelay.perform")
        && (item as any).candidateOrigin === "recall_direct_boundary_surface");
    assert(opaqueRelayCandidate, "unknown third-party calls without network/SDK keywords should still become API modeling candidates when imported and invoked with a value");
    const relativeProjectStoreReadCandidate = apiCandidates.find(item =>
        item.method === "getData"
        && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
        && String(item.callee_signature).includes("ProjectKvStore.getData")
        && (item as any).candidateOrigin === "recall_direct_boundary_surface");
    assert(relativeProjectStoreReadCandidate, "relative project storage utility calls with resolved import and key evidence should become direct boundary candidates");
    assert(
        ((relativeProjectStoreReadCandidate as any).topEntries || []).some((entry: string) => entry.includes("directBoundaryResolvedImport=true")),
        "relative project direct boundary candidates should expose resolved import evidence",
    );
    assert(
        ((relativeProjectStoreReadCandidate as any).topEntries || []).some((entry: string) => entry.includes("resolvedImportFile=")),
        "relative project storage direct boundary candidates should expose resolved import file evidence",
    );
    const relativeProjectStoreWriteCandidate = apiCandidates.find(item =>
        item.method === "putData"
        && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
        && String(item.callee_signature).includes("ProjectKvStore.putData")
        && (item as any).candidateOrigin === "recall_direct_boundary_surface");
    assert(relativeProjectStoreWriteCandidate, "relative project storage utility writes with key/value evidence should become direct boundary candidates");
    assert(
        !apiCandidates.some(item =>
            item.method === "getData"
            && String(item.sourceFile).endsWith("pages/StaticStoragePage.ets")
            && String(item.callee_signature).includes("LocalHelper.getData")
            && (item as any).candidateOrigin === "recall_direct_boundary_surface"),
        "visible transparent local helpers must be treated as IR-explained and stay out of API modeling recall",
    );
    const eventHubDispatchCandidate = apiCandidates.find(item =>
        item.method === "sendEvent"
        && String(item.sourceFile).endsWith("common/EventHub.ets"));
    assert(eventHubDispatchCandidate, "project event-bus dispatch method should become companion API evidence for callback activation modeling");
    const eventHubCallbackItem = buildSemanticFlowApiModelingCandidateItem(eventHubCallbackCandidate, {
        companionCandidates: apiCandidates,
    });
    assert(eventHubCallbackItem.initialSlice.observations.some(line => line.includes("receiver=EventHub")),
        "EventHub callback item should expose receiver evidence");
    assert(eventHubCallbackItem.initialSlice.observations.some(line => line.includes("resolvedReceiverFile=entry/src/main/ets/common/EventHub.ets")),
        "EventHub callback item should expose analyzer-backed receiver file evidence");
    const eventHubEvidence = eventHubCallbackItem.initialSlice.snippets.map(snippet => `${snippet.label}\n${snippet.code || ""}`).join("\n");
    assert(eventHubEvidence.includes("EventHub.sendEvent") || eventHubEvidence.includes("method: sendEvent"),
        "EventHub callback evidence should include dispatch companion evidence for module.eventEmitter modeling");
    assert(eventHubEvidence.includes("EventKey.LoginWebDav"),
        "EventHub callback evidence should retain enum-key registration/dispatch usage");
    assert(apiMethods.has("sendTextMessage"), "viewmodel wrapper that sends payload through a third-party SDK should become a recalled API modeling candidate");
    assert(apiMethods.has("sendMessage"), "viewmodel wrapper that reaches a third-party SDK send API should become a recalled API modeling candidate");
    assert(!apiMethods.has("checkPhone"), "page validation helper should not become a recalled API wrapper candidate");
    assert(!apiMethods.has("scrollToLatest"), "pure UI viewmodel helper should not become a recalled API wrapper candidate");
    const credentialCandidate = apiCandidates.find(item =>
        item.method === "getUserCredential" && (item as any).candidateOrigin === "recall_api_surface");
    assert(credentialCandidate, "missing getUserCredential recalled API candidate");
    assert((credentialCandidate as any).candidateOrigin === "recall_api_surface", "API surface candidate should expose neutral recall origin");
    assert(typeof (credentialCandidate as any).methodSnippet === "string" && (credentialCandidate as any).methodSnippet.includes("Axios.post"), "API wrapper candidate should carry method body evidence");
    const sendTextCandidate = apiCandidates.find(item =>
        item.method === "sendTextMessage" && String(item.sourceFile).endsWith("viewmodels/MessageViewModel.ets"));
    assert(sendTextCandidate, "missing viewmodel sendTextMessage recalled API candidate");
    const baseSendTextCandidate = apiCandidates.find(item =>
        item.method === "sendTextMessage"
        && String(item.sourceFile).endsWith("viewmodels/MessageViewModel.ets")
        && String(item.callee_signature).includes("BaseMessageViewModel.sendTextMessage"));
    assert(baseSendTextCandidate, "scanner should add analyzer-compatible declared owner candidate for BaseMessageViewModel.sendTextMessage");
    assert(
        ((baseSendTextCandidate as any).topEntries || []).some((entry: string) => entry.includes("declaredOwnerFromCallsite=BaseMessageViewModel")),
        "declared owner candidate should expose callsite owner evidence",
    );
    assert(
        !apiCandidates.some(item =>
            item.method === "sendTextMessage"
            && String(item.sourceFile).endsWith("viewmodels/MessageViewModel.ets")
            && String(item.callee_signature).includes("UnrelatedBase.sendTextMessage")),
        "scanner must not add declared-owner candidates when implementation owner is not inheritance-compatible",
    );
    const declaredOwnerSelection = selectSemanticFlowRuleCandidatesForModeling([
        sendTextCandidate,
        baseSendTextCandidate,
    ] as any, 1);
    assert(
        declaredOwnerSelection.length === 2
        && declaredOwnerSelection.some(item => String(item.callee_signature).includes("BaseMessageViewModel.sendTextMessage"))
        && declaredOwnerSelection.some(item => String(item.callee_signature).includes("MessageViewModel.sendTextMessage")),
        "SemanticFlow candidate queue should retain both implementation-owner and analyzer-backed declared-owner surfaces; identity compatibility is resolved after modeling, not by queue exclusion",
    );
    const sendMessageCandidate = apiCandidates.find(item =>
        item.method === "sendMessage" && String(item.sourceFile).endsWith("viewmodels/MessageViewModel.ets"));
    assert(sendMessageCandidate, "missing viewmodel sendMessage recalled API candidate");
    assert(
        ((sendTextCandidate as any).topEntries || []).some((entry: string) => entry.includes("candidateBoundary=project_or_third_party_wrapper_evidence")),
        "viewmodel SDK wrapper candidate should carry project wrapper boundary evidence",
    );
    const chainedSelection = selectSemanticFlowRuleCandidatesForModeling([
        {
            callee_signature: "@%unk/%unk: .ChatInputMenuView()",
            method: "ChatInputMenuView",
            invokeKind: "static",
            argCount: 1,
            sourceFile: "components/chat/ChatComponents.ets",
            count: 1,
            topEntries: [],
            candidateOrigin: "recall_callback_surface",
            callbackProperties: ["onClickSend"],
            contextSlices: [{
                callerFile: "components/chat/ChatView.ets",
                invokeLine: 10,
                invokeStmtText: "ChatInputMenuView({ onClickSend: (content: MessageContent) => { this.messageViewModel.sendTextMessage(content); } })",
                windowLines: "onClickSend: (content: MessageContent) => { this.messageViewModel.sendTextMessage(content); }",
                cfgNeighborStmts: [],
            }],
        },
        sendTextCandidate,
        sendMessageCandidate,
        {
            callee_signature: "@demo/services/ProfileService.ets: ProfileService.getUserProfile(Unknown)",
            method: "getUserProfile",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "services/ProfileService.ets",
            count: 30,
            topEntries: ["origin=recall_api_surface", "candidateBoundary=project_or_third_party_wrapper_evidence"],
            candidateOrigin: "recall_api_surface",
            methodSnippet: "getUserProfile(token: string) { return this.client.request(token); }",
        },
    ] as any, 4);
    assert(
        chainedSelection.some(item => item.method === "ChatInputMenuView"),
        "small SemanticFlow budget should keep the callback source candidate",
    );
    assert(
        chainedSelection.some(item => item.method === "sendTextMessage"),
        "small SemanticFlow budget should keep the project API directly called from callback source context",
    );
    assert(
        chainedSelection.some(item => item.method === "sendMessage"),
        "small SemanticFlow budget should keep the next project API directly called from the selected wrapper context",
    );
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
    const multilineRequestCandidate = apiCandidates.find(item =>
        item.method === "_request" && String(item.sourceFile).endsWith("network/MultiLinePrivateClient.ets"));
    assert(multilineRequestCandidate, "multiline private boundary method should be recalled as a project API candidate");
    assert(
        typeof (multilineRequestCandidate as any).methodSnippet === "string"
        && (multilineRequestCandidate as any).methodSnippet.includes("mergedHeaders")
        && (multilineRequestCandidate as any).methodSnippet.includes("Session().fetch"),
        "multiline private boundary candidate should carry its full method body evidence",
    );
    const multilinePropfindCandidate = apiCandidates.find(item =>
        item.method === "propfind" && String(item.sourceFile).endsWith("network/MultiLinePrivateClient.ets"));
    assert(multilinePropfindCandidate, "public wrapper that calls a multiline private boundary should be recalled");
    const multilinePropfindItem = buildSemanticFlowApiModelingCandidateItem(multilinePropfindCandidate, {
        companionCandidates: apiCandidates,
    });
    const multilineCompanionEvidence = multilinePropfindItem.initialSlice.snippets.map(snippet => snippet.code || "").join("\n");
    assert(
        multilineCompanionEvidence.includes("method: _request")
        && multilineCompanionEvidence.includes("mergedHeaders")
        && multilineCompanionEvidence.includes("console.debug"),
        "SemanticFlow companion evidence should inline multiline private boundary methods called by project wrappers",
    );
    assert(
        !apiCandidates.some(item =>
            item.method === "formatLocal" && String(item.sourceFile).endsWith("pages/LocalOnlyPage.ets")),
        "multiline local-only helpers without boundary effects must not become project API candidates",
    );
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
        "logging payload methods should remain ahead of logger factory/cache helpers in the structural queue");
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
    const hybridProxyCandidate = apiCandidates.find(item =>
        item.method === "invoke" && String(item.sourceFile).endsWith("HybridContainer/DMPWebViewProxy.ets"));
    assert(hybridProxyCandidate, "WebView/JS proxy receiver methods in HybridContainer should become recalled API modeling candidates");
    assert((hybridProxyCandidate.topEntries || []).includes("candidateBoundary=project_or_third_party_bridge_evidence"),
        "HybridContainer WebView proxy candidate should carry bridge evidence");
    const hybridHelperCandidate = apiCandidates.find(item =>
        item.method === "getWebViewId" && String(item.sourceFile).endsWith("HybridContainer/DMPWebViewProxy.ets"));
    assert(!hybridHelperCandidate, "ordinary HybridContainer helper methods must not become bridge candidates");
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
