const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const outputRoot = path.join(
  repoRoot,
  "internal_docs/reports/chapter3_experiment_artifacts/final/datasets/semanticflow_331_evidence_ablation",
);

const {
  discoverApiSurfaceModelingCandidates,
  discoverApiCallbackModelingCandidates,
} = require(path.join(repoRoot, "out/core/semanticflow/ApiModelingCandidateScanner"));
const {
  buildSemanticFlowApiModelingCandidateItem,
  buildSemanticFlowArkMainCandidateItem,
} = require(path.join(repoRoot, "out/core/semanticflow/SemanticFlowAdapters"));
const {
  buildSemanticFlowPrompt,
} = require(path.join(repoRoot, "out/core/semanticflow/SemanticFlowPrompt"));
const { Scene } = require(path.join(repoRoot, "arkanalyzer/out/src/Scene"));
const { SceneConfig } = require(path.join(repoRoot, "arkanalyzer/out/src/Config"));
const {
  buildArkMainEntryCandidates,
} = require(path.join(repoRoot, "out/core/entry/arkmain/llm/ArkMainEntryCandidateBuilder"));

const SOURCE_DIRS = ["entry/src/main/ets"];

const VARIANTS = [
  {
    id: "L0_NAME_SIGNATURE_ONLY",
    label: "Name and signature only",
    appliesTo: () => true,
    mutate: makeNameSignatureOnly,
  },
  {
    id: "L1_IDENTITY_ONLY",
    label: "Exact identity only",
    appliesTo: () => true,
    mutate: makeIdentityOnly,
  },
  {
    id: "L2_NO_CALLSITE",
    label: "No callsite context",
    appliesTo: () => true,
    mutate: makeNoCallsite,
  },
  {
    id: "L3_NO_METHOD_SNIPPET",
    label: "No method snippet",
    appliesTo: () => true,
    mutate: makeNoMethodSnippet,
  },
  {
    id: "L4_NO_COMPANION",
    label: "No companion surfaces",
    appliesTo: () => true,
    mutate: makeNoCompanion,
  },
  {
    id: "L5_NO_EXACT_IDENTITY",
    label: "No exact identity evidence",
    appliesTo: () => true,
    mutate: makeNoExactIdentity,
  },
  {
    id: "L6_NO_OFFICIAL_ENTRY_EVIDENCE",
    label: "No ArkMain official declaration evidence",
    appliesTo: sample => sample.expectedPlane === "arkmain",
    mutate: makeNoOfficialEntryEvidence,
  },
  {
    id: "L7_FULL_SLICE",
    label: "Full engine slice",
    appliesTo: () => true,
    mutate: identityVariant,
  },
];

const scenarios = [
  {
    id: "source_device_and_profile",
    files: {
      "entry/src/main/ets/services/DeviceSdk.ets": [
        "declare const NativeDevice: { readDeviceId(): string; readSerial(): string };",
        "export class DeviceSdk {",
        "  static getDeviceId(): string {",
        "    const deviceId = NativeDevice.readDeviceId();",
        "    return deviceId;",
        "  }",
        "  static getSerialNumber(): string {",
        "    return NativeDevice.readSerial();",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/services/ProfileSdk.ets": [
        "declare const AccountBridge: { currentUser(): Promise<string>; };",
        "export class ProfileSdk {",
        "  static async getCurrentUserId(): Promise<string> {",
        "    const userId = await AccountBridge.currentUser();",
        "    return userId;",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/ProfilePage.ets": [
        "import { DeviceSdk } from '../services/DeviceSdk';",
        "import { ProfileSdk } from '../services/ProfileSdk';",
        "import { AnalyticsBridge } from '../sinks/AnalyticsBridge';",
        "@Entry",
        "@Component",
        "export struct ProfilePage {",
        "  aboutToAppear(): void {",
        "    const deviceId = DeviceSdk.getDeviceId();",
        "    AnalyticsBridge.trackProfile(deviceId);",
        "  }",
        "  async loadProfile(): Promise<void> {",
        "    const userId = await ProfileSdk.getCurrentUserId();",
        "    AnalyticsBridge.trackProfile(userId);",
        "  }",
        "  build() {}",
        "}",
      ].join("\n"),
      "entry/src/main/ets/sinks/AnalyticsBridge.ets": [
        "declare const AnalyticsNative: { track(name: string, payload: string): void };",
        "export class AnalyticsBridge {",
        "  static trackProfile(payload: string): void {",
        "    AnalyticsNative.track('profile', payload);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      ruleSample("SF331-RULE-SOURCE-001", "getDeviceId", "DeviceSdk.ets", "source", ["rule.source"], endpoint("return"), "simple", "device id source"),
      ruleSample("SF331-RULE-SOURCE-002", "getSerialNumber", "DeviceSdk.ets", "source", ["rule.source"], endpoint("return"), "simple", "serial number source"),
      ruleSample("SF331-RULE-SOURCE-003", "getCurrentUserId", "ProfileSdk.ets", "source", ["rule.source"], endpoint("promiseResult"), "medium", "promise fulfilled user id source"),
      ruleSample("SF331-RULE-SINK-001", "trackProfile", "AnalyticsBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "simple", "analytics payload sink"),
      arkMainSample("SF331-ARKMAIN-001", "aboutToAppear", "entry lifecycle", "page_lifecycle"),
      arkMainSample("SF331-ARKMAIN-002", "build", "entry build", "page_build"),
    ],
  },
  {
    id: "network_logging_file_database_sinks",
    files: {
      "entry/src/main/ets/sinks/NetworkBridge.ets": [
        "declare const HttpNative: { post(url: string, body: string, headers: Record<string, string>): Promise<void> };",
        "export class NetworkBridge {",
        "  static postProfile(profileJson: string, authToken: string): Promise<void> {",
        "    const headers: Record<string, string> = { Authorization: authToken };",
        "    return HttpNative.post('/profile', profileJson, headers);",
        "  }",
        "  static postTelemetry(deviceId: string, eventName: string): Promise<void> {",
        "    return HttpNative.post('/telemetry', JSON.stringify({ deviceId, eventName }), {});",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/sinks/LogFileDbBridge.ets": [
        "declare const LoggerNative: { error(tag: string, msg: string): void };",
        "declare const FileNative: { write(path: string, content: string): void };",
        "declare const RdbNative: { insert(table: string, values: Record<string, string>): void; update(table: string, values: Record<string, string>): void };",
        "export class LogFileDbBridge {",
        "  static logError(message: string): void {",
        "    LoggerNative.error('app', message);",
        "  }",
        "  static writeCache(content: string): void {",
        "    FileNative.write('/data/cache/profile.txt', content);",
        "  }",
        "  static insertSearchKeyword(keyword: string): void {",
        "    RdbNative.insert('search_history', { keyword });",
        "  }",
        "  static updateAccountToken(token: string): void {",
        "    RdbNative.update('account', { token });",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/SinkPage.ets": [
        "import { NetworkBridge } from '../sinks/NetworkBridge';",
        "import { LogFileDbBridge } from '../sinks/LogFileDbBridge';",
        "export class SinkPage {",
        "  submit(token: string, profile: string): void {",
        "    NetworkBridge.postProfile(profile, token);",
        "    NetworkBridge.postTelemetry(token, 'login');",
        "    LogFileDbBridge.logError(token);",
        "    LogFileDbBridge.writeCache(profile);",
        "    LogFileDbBridge.insertSearchKeyword(token);",
        "    LogFileDbBridge.updateAccountToken(token);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      ruleSample("SF331-RULE-SINK-002", "postProfile", "NetworkBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "medium", "network body sink"),
      ruleSample("SF331-RULE-SINK-003", "postTelemetry", "NetworkBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "medium", "network telemetry payload sink"),
      ruleSample("SF331-RULE-SINK-004", "logError", "LogFileDbBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "simple", "logging sink"),
      ruleSample("SF331-RULE-SINK-005", "writeCache", "LogFileDbBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "simple", "file write sink"),
      ruleSample("SF331-RULE-SINK-006", "insertSearchKeyword", "LogFileDbBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "medium", "database insert sink"),
      ruleSample("SF331-RULE-SINK-007", "updateAccountToken", "LogFileDbBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "medium", "database update sink"),
    ],
  },
  {
    id: "transfer_and_sanitizer_wrappers",
    files: {
      "entry/src/main/ets/common/TransferBridge.ets": [
        "export class TransferBridge {",
        "  static identity(value: string): string {",
        "    return value;",
        "  }",
        "  static wrapProfile(userId: string, token: string): Record<string, string> {",
        "    return { userId, token };",
        "  }",
        "  static unwrapToken(input: Record<string, string>): string {",
        "    return input.token;",
        "  }",
        "  static async passAsync(payload: string): Promise<string> {",
        "    return Promise.resolve(payload);",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/common/SanitizeBridge.ets": [
        "declare const CryptoNative: { sha256(value: string): string; encrypt(value: string): string };",
        "export class SanitizeBridge {",
        "  static hashPassword(password: string): string {",
        "    return CryptoNative.sha256(password);",
        "  }",
        "  static encryptToken(token: string): string {",
        "    return CryptoNative.encrypt(token);",
        "  }",
        "  static maskPhone(phone: string): string {",
        "    return phone.slice(0, 3) + '****' + phone.slice(7);",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/TransferPage.ets": [
        "import { TransferBridge } from '../common/TransferBridge';",
        "import { SanitizeBridge } from '../common/SanitizeBridge';",
        "export class TransferPage {",
        "  async submit(secret: string): Promise<void> {",
        "    const copied = TransferBridge.identity(secret);",
        "    const wrapped = TransferBridge.wrapProfile(copied, secret);",
        "    const token = TransferBridge.unwrapToken(wrapped);",
        "    const asyncValue = await TransferBridge.passAsync(token);",
        "    SanitizeBridge.hashPassword(asyncValue);",
        "    SanitizeBridge.encryptToken(asyncValue);",
        "    SanitizeBridge.maskPhone(asyncValue);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      ruleSample("SF331-RULE-TRANSFER-001", "identity", "TransferBridge.ets", "transfer", ["rule.transfer"], endpoint("return"), "simple", "arg0 to return transfer"),
      ruleSample("SF331-RULE-TRANSFER-002", "wrapProfile", "TransferBridge.ets", "transfer", ["rule.transfer"], endpoint("return"), "medium", "args to object return transfer"),
      ruleSample("SF331-RULE-TRANSFER-003", "unwrapToken", "TransferBridge.ets", "transfer", ["rule.transfer"], endpoint("return"), "medium", "object field to return transfer"),
      ruleSample("SF331-RULE-TRANSFER-004", "passAsync", "TransferBridge.ets", "transfer", ["rule.transfer"], endpoint("promiseResult"), "medium", "arg0 to promise result transfer"),
      ruleSample("SF331-RULE-SANITIZER-001", "hashPassword", "SanitizeBridge.ets", "sanitizer", ["rule.sanitizer"], endpoint("arg", 0), "simple", "cryptographic hash sanitizer"),
      ruleSample("SF331-RULE-SANITIZER-002", "encryptToken", "SanitizeBridge.ets", "sanitizer", ["rule.sanitizer"], endpoint("arg", 0), "simple", "encryption sanitizer"),
      ruleSample("SF331-RULE-SANITIZER-003", "maskPhone", "SanitizeBridge.ets", "sanitizer", ["rule.sanitizer"], endpoint("arg", 0), "medium", "masking sanitizer"),
    ],
  },
  {
    id: "event_bus_and_callback_sources",
    files: {
      "entry/src/main/ets/common/ProjectEventHub.ets": [
        "export class ProjectEventHub {",
        "  private static listeners: Map<string, Array<(payload: string) => void>> = new Map();",
        "  static on(name: string, callback: (payload: string) => void): void {",
        "    const list = ProjectEventHub.listeners.get(name) ?? [];",
        "    list.push(callback);",
        "    ProjectEventHub.listeners.set(name, list);",
        "  }",
        "  static emit(name: string, payload: string): void {",
        "    const list = ProjectEventHub.listeners.get(name) ?? [];",
        "    for (const callback of list) {",
        "      callback(payload);",
        "    }",
        "  }",
        "  static emitReady(name: string): void {",
        "    const list = ProjectEventHub.listeners.get(name) ?? [];",
        "    for (const callback of list) {",
        "      callback('ready');",
        "    }",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/EventPage.ets": [
        "import { ProjectEventHub } from '../common/ProjectEventHub';",
        "@Entry",
        "@Component",
        "export struct EventPage {",
        "  aboutToAppear(): void {",
        "    ProjectEventHub.on('token-ready', (payload: string) => {",
        "      this.submit(payload);",
        "    });",
        "  }",
        "  submit(token: string): void {",
        "    ProjectEventHub.emit('audit', token);",
        "    ProjectEventHub.emitReady('ui-ready');",
        "  }",
        "  build() {}",
        "}",
      ].join("\n"),
    },
    samples: [
      moduleSample("SF331-MODULE-EVENT-001", "on", "ProjectEventHub.ets", ["module.eventEmitter"], "event registration and payload callback"),
      moduleSample("SF331-MODULE-EVENT-002", "emit", "ProjectEventHub.ets", ["module.eventEmitter"], "event dispatch with payload"),
      moduleSample("SF331-MODULE-EVENT-003", "emitReady", "ProjectEventHub.ets", ["module.eventEmitter"], "event dispatch without caller payload"),
      arkMainSample("SF331-ARKMAIN-003", "aboutToAppear", "event page lifecycle", "page_lifecycle"),
      arkMainSample("SF331-ARKMAIN-004", "build", "event page build", "page_build"),
    ],
  },
  {
    id: "storage_state_router_handoff",
    files: {
      "entry/src/main/ets/common/VaultStorage.ets": [
        "declare const PreferencesNative: { put(name: string, key: string, value: string): void; get(name: string, key: string): string; delete(name: string, key: string): void };",
        "export class VaultStorage {",
        "  static saveToken(userId: string, token: string): void {",
        "    PreferencesNative.put('vault', userId, token);",
        "  }",
        "  static loadToken(userId: string): string {",
        "    return PreferencesNative.get('vault', userId);",
        "  }",
        "  static clearToken(userId: string): void {",
        "    PreferencesNative.delete('vault', userId);",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/common/SessionState.ets": [
        "export class SessionState {",
        "  private static values: Map<string, string> = new Map();",
        "  static setCurrent(key: string, value: string): void {",
        "    SessionState.values.set(key, value);",
        "  }",
        "  static getCurrent(key: string): string {",
        "    return SessionState.values.get(key) ?? '';",
        "  }",
        "  static removeCurrent(key: string): void {",
        "    SessionState.values.delete(key);",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/common/RouterBridge.ets": [
        "declare const RouterNative: { pushUrl(options: Record<string, string>): void; getParam(name: string): string };",
        "export class RouterBridge {",
        "  static pushDetail(id: string, token: string): void {",
        "    RouterNative.pushUrl({ url: 'pages/Detail', id, token });",
        "  }",
        "  static readDetailToken(): string {",
        "    return RouterNative.getParam('token');",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/StoragePage.ets": [
        "import { VaultStorage } from '../common/VaultStorage';",
        "import { SessionState } from '../common/SessionState';",
        "import { RouterBridge } from '../common/RouterBridge';",
        "export class StoragePage {",
        "  use(token: string): void {",
        "    VaultStorage.saveToken('me', token);",
        "    const saved = VaultStorage.loadToken('me');",
        "    SessionState.setCurrent('token', saved);",
        "    const current = SessionState.getCurrent('token');",
        "    RouterBridge.pushDetail('42', current);",
        "    RouterBridge.readDetailToken();",
        "    VaultStorage.clearToken('me');",
        "    SessionState.removeCurrent('token');",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      moduleSample("SF331-MODULE-STORAGE-001", "saveToken", "VaultStorage.ets", ["handoff.put"], "persistent storage put"),
      moduleSample("SF331-MODULE-STORAGE-002", "loadToken", "VaultStorage.ets", ["handoff.get"], "persistent storage get"),
      moduleSample("SF331-MODULE-STORAGE-003", "clearToken", "VaultStorage.ets", ["handoff.kill"], "persistent storage kill"),
      moduleSample("SF331-MODULE-STATE-001", "setCurrent", "SessionState.ets", ["handoff.put"], "state map put"),
      moduleSample("SF331-MODULE-STATE-002", "getCurrent", "SessionState.ets", ["handoff.get"], "state map get"),
      moduleSample("SF331-MODULE-STATE-003", "removeCurrent", "SessionState.ets", ["handoff.kill"], "state map kill"),
      moduleSample("SF331-MODULE-ROUTER-001", "pushDetail", "RouterBridge.ets", ["handoff.put"], "navigation param put"),
      moduleSample("SF331-MODULE-ROUTER-002", "readDetailToken", "RouterBridge.ets", ["handoff.get"], "navigation param get"),
    ],
  },
  {
    id: "receiver_field_and_request_builder",
    files: {
      "entry/src/main/ets/common/HeaderRequestBuilder.ets": [
        "declare const HttpNative: { post(url: string, headers: Record<string, string>, body: string): Promise<void> };",
        "export class HeaderRequestBuilder {",
        "  private options: Record<string, string> = {};",
        "  private requestHeaders: Record<string, string> = {};",
        "  setSecret(secret: string): HeaderRequestBuilder {",
        "    this.options.secret = secret;",
        "    return this;",
        "  }",
        "  buildHeaders(): Record<string, string> {",
        "    this.requestHeaders = { Authorization: this.options.secret };",
        "    return this.requestHeaders;",
        "  }",
        "  request(body: string): Promise<void> {",
        "    const headers = this.buildHeaders();",
        "    return HttpNative.post('/secure', headers, body);",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/BuilderPage.ets": [
        "import { HeaderRequestBuilder } from '../common/HeaderRequestBuilder';",
        "export class BuilderPage {",
        "  submit(token: string, body: string): void {",
        "    const builder = new HeaderRequestBuilder();",
        "    builder.setSecret(token).request(body);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      moduleSample("SF331-MODULE-OBJECTFIELD-001", "setSecret", "HeaderRequestBuilder.ets", ["handoff.put"], "receiver field put"),
      ruleSample("SF331-RULE-SINK-008", "request", "HeaderRequestBuilder.ets", "sink", ["rule.sink"], endpoint("arg", 0), "complex", "request body sink with receiver header carrier"),
    ],
  },
  {
    id: "promise_worker_and_async_handoff",
    files: {
      "entry/src/main/ets/common/AsyncTaskBridge.ets": [
        "declare const WorkerNative: { run(name: string, payload: string): Promise<string>; cancel(name: string): void };",
        "export class AsyncTaskBridge {",
        "  static scheduleTokenTask(token: string): Promise<string> {",
        "    return WorkerNative.run('token-task', token);",
        "  }",
        "  static resolveTokenTask(token: string): Promise<string> {",
        "    return Promise.resolve(token);",
        "  }",
        "  static cancelTokenTask(): void {",
        "    WorkerNative.cancel('token-task');",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/AsyncPage.ets": [
        "import { AsyncTaskBridge } from '../common/AsyncTaskBridge';",
        "export class AsyncPage {",
        "  async run(token: string): Promise<void> {",
        "    const scheduled = await AsyncTaskBridge.scheduleTokenTask(token);",
        "    const resolved = await AsyncTaskBridge.resolveTokenTask(scheduled);",
        "    AsyncTaskBridge.cancelTokenTask();",
        "    resolved.length;",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      moduleSample("SF331-MODULE-ASYNC-001", "scheduleTokenTask", "AsyncTaskBridge.ets", ["handoff.put", "handoff.get"], "worker async result handoff"),
      ruleSample("SF331-RULE-TRANSFER-005", "resolveTokenTask", "AsyncTaskBridge.ets", "transfer", ["rule.transfer"], endpoint("promiseResult"), "medium", "promise result transfer"),
      moduleSample("SF331-MODULE-ASYNC-002", "cancelTokenTask", "AsyncTaskBridge.ets", ["handoff.kill"], "worker task cancel"),
    ],
  },
  {
    id: "credential_transform_and_export",
    files: {
      "entry/src/main/ets/security/CredentialKit.ets": [
        "declare const SecretNative: { readClipboard(): string; readLocation(): string; upload(value: string): void; audit(value: string): void };",
        "export class CredentialKit {",
        "  static getClipboardSecret(): string {",
        "    return SecretNative.readClipboard();",
        "  }",
        "  static getLocationCode(): string {",
        "    return SecretNative.readLocation();",
        "  }",
        "  static copySecret(secret: string): string {",
        "    return secret;",
        "  }",
        "  static mergeCredential(userId: string, token: string): Record<string, string> {",
        "    return { userId, token };",
        "  }",
        "  static redactEmail(email: string): string {",
        "    return email.replace(/(.).+(@.+)/, '$1***$2');",
        "  }",
        "  static encryptSessionKey(key: string): string {",
        "    return 'enc:' + key;",
        "  }",
        "  static uploadCredential(secret: string): void {",
        "    SecretNative.upload(secret);",
        "  }",
        "  static logCredential(secret: string): void {",
        "    SecretNative.audit(secret);",
        "  }",
        "  static chooseCredentialLabel(kind: string): string {",
        "    return kind === 'token' ? 'Token' : 'Credential';",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/CredentialPage.ets": [
        "import { CredentialKit } from '../security/CredentialKit';",
        "export class CredentialPage {",
        "  submit(userId: string, token: string): void {",
        "    const clipboardSecret = CredentialKit.getClipboardSecret();",
        "    const copied = CredentialKit.copySecret(clipboardSecret);",
        "    const merged = CredentialKit.mergeCredential(userId, token);",
        "    const encrypted = CredentialKit.encryptSessionKey(copied);",
        "    const masked = CredentialKit.redactEmail(userId);",
        "    CredentialKit.uploadCredential(encrypted);",
        "    CredentialKit.logCredential(merged.token);",
        "    CredentialKit.chooseCredentialLabel(masked);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      ruleSample("SF331-RULE-SOURCE-007", "getClipboardSecret", "CredentialKit.ets", "source", ["rule.source"], endpoint("return"), "simple", "clipboard credential source"),
      ruleSample("SF331-RULE-SOURCE-008", "getLocationCode", "CredentialKit.ets", "source", ["rule.source"], endpoint("return"), "simple", "location-derived source"),
      ruleSample("SF331-RULE-TRANSFER-006", "copySecret", "CredentialKit.ets", "transfer", ["rule.transfer"], endpoint("return"), "simple", "direct arg0 to return transfer"),
      ruleSample("SF331-RULE-TRANSFER-007", "mergeCredential", "CredentialKit.ets", "transfer", ["rule.transfer"], endpoint("return"), "medium", "multi-arg object return transfer"),
      ruleSample("SF331-RULE-SANITIZER-004", "redactEmail", "CredentialKit.ets", "sanitizer", ["rule.sanitizer"], endpoint("arg", 0), "medium", "redaction sanitizer"),
      ruleSample("SF331-RULE-SANITIZER-005", "encryptSessionKey", "CredentialKit.ets", "sanitizer", ["rule.sanitizer"], endpoint("arg", 0), "simple", "encryption sanitizer"),
      ruleSample("SF331-RULE-SINK-012", "uploadCredential", "CredentialKit.ets", "sink", ["rule.sink"], endpoint("arg", 0), "simple", "credential upload sink"),
      ruleSample("SF331-RULE-SINK-013", "logCredential", "CredentialKit.ets", "sink", ["rule.sink"], endpoint("arg", 0), "simple", "credential audit log sink"),
      negativeSample("SF331-NEG-008", "chooseCredentialLabel", "CredentialKit.ets", "display label helper is not a security semantic asset"),
    ],
  },
  {
    id: "negative_ordinary_helpers",
    files: {
      "entry/src/main/ets/common/DisplayFormatter.ets": [
        "export class DisplayFormatter {",
        "  static formatTitle(title: string): string {",
        "    return '[' + title.trim() + ']';",
        "  }",
        "  static buildButtonLabel(count: number): string {",
        "    return 'Total ' + count;",
        "  }",
        "  static validateLength(value: string): boolean {",
        "    return value.length > 3;",
        "  }",
        "  static chooseTheme(dark: boolean): string {",
        "    return dark ? 'dark' : 'light';",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/FormatterPage.ets": [
        "import { DisplayFormatter } from '../common/DisplayFormatter';",
        "export class FormatterPage {",
        "  render(title: string): void {",
        "    DisplayFormatter.formatTitle(title);",
        "    DisplayFormatter.buildButtonLabel(3);",
        "    DisplayFormatter.validateLength(title);",
        "    DisplayFormatter.chooseTheme(false);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      negativeSample("SF331-NEG-001", "formatTitle", "DisplayFormatter.ets", "ordinary formatter with no registered taint semantics"),
      negativeSample("SF331-NEG-002", "buildButtonLabel", "DisplayFormatter.ets", "UI label helper with no source/sink/transfer semantics"),
      negativeSample("SF331-NEG-003", "validateLength", "DisplayFormatter.ets", "validation predicate is not a sanitizer by itself"),
      negativeSample("SF331-NEG-004", "chooseTheme", "DisplayFormatter.ets", "theme branch helper has no security asset semantics"),
    ],
  },
  {
    id: "negative_metadata_and_control",
    files: {
      "entry/src/main/ets/common/RequestMetadata.ets": [
        "declare const HttpNative: { post(url: string, method: string, body: string): void };",
        "export class RequestMetadata {",
        "  static buildMethod(method: string): string {",
        "    return method.toUpperCase();",
        "  }",
        "  static chooseEndpoint(routeName: string): string {",
        "    return '/api/' + routeName;",
        "  }",
        "  static sendWithControl(routeName: string, method: string): void {",
        "    const route = RequestMetadata.chooseEndpoint(routeName);",
        "    const verb = RequestMetadata.buildMethod(method);",
        "    HttpNative.post(route, verb, '{}');",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/MetadataPage.ets": [
        "import { RequestMetadata } from '../common/RequestMetadata';",
        "export class MetadataPage {",
        "  submit(route: string): void {",
        "    RequestMetadata.sendWithControl(route, 'post');",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      negativeSample("SF331-NEG-005", "buildMethod", "RequestMetadata.ets", "HTTP method metadata is not payload sink"),
      negativeSample("SF331-NEG-006", "chooseEndpoint", "RequestMetadata.ets", "route selection metadata is not payload sink by default"),
      negativeSample("SF331-NEG-007", "sendWithControl", "RequestMetadata.ets", "control-only request wrapper has no caller payload disclosure"),
    ],
  },
  {
    id: "named_default_namespace_imports",
    files: {
      "entry/src/main/ets/sdk/NamedSdk.ets": [
        "declare const NamedNative: { readOpenId(): string; sendSecret(value: string): void };",
        "export function readOpenId(): string {",
        "  return NamedNative.readOpenId();",
        "}",
        "export function sendSecret(value: string): void {",
        "  NamedNative.sendSecret(value);",
        "}",
      ].join("\n"),
      "entry/src/main/ets/sdk/DefaultSdk.ets": [
        "declare const DefaultNative: { token(): string };",
        "export default class DefaultSdk {",
        "  static token(): string {",
        "    return DefaultNative.token();",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/ImportPage.ets": [
        "import DefaultSdk from '../sdk/DefaultSdk';",
        "import { readOpenId, sendSecret } from '../sdk/NamedSdk';",
        "export class ImportPage {",
        "  run(): void {",
        "    const openId = readOpenId();",
        "    const token = DefaultSdk.token();",
        "    sendSecret(openId + token);",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      ruleSample("SF331-RULE-SOURCE-004", "readOpenId", "NamedSdk.ets", "source", ["rule.source"], endpoint("return"), "medium", "named import free function source"),
      ruleSample("SF331-RULE-SOURCE-005", "token", "DefaultSdk.ets", "source", ["rule.source"], endpoint("return"), "medium", "default import class static source"),
      ruleSample("SF331-RULE-SINK-009", "sendSecret", "NamedSdk.ets", "sink", ["rule.sink"], endpoint("arg", 0), "medium", "named import free function sink"),
    ],
  },
  {
    id: "overload_rest_object_shape",
    files: {
      "entry/src/main/ets/common/ShapeBridge.ets": [
        "declare const ShapeNative: { send(values: string[]): void; read(options: Record<string, string>): string };",
        "export class ShapeBridge {",
        "  static sendAll(...values: string[]): void {",
        "    ShapeNative.send(values);",
        "  }",
        "  static sendObject(options: { token: string, deviceId: string }): void {",
        "    ShapeNative.send([options.token, options.deviceId]);",
        "  }",
        "  static readObject(options: { field: string }): string {",
        "    return ShapeNative.read({ field: options.field });",
        "  }",
        "}",
      ].join("\n"),
      "entry/src/main/ets/pages/ShapePage.ets": [
        "import { ShapeBridge } from '../common/ShapeBridge';",
        "export class ShapePage {",
        "  run(token: string): void {",
        "    ShapeBridge.sendAll(token, 'debug');",
        "    ShapeBridge.sendObject({ token, deviceId: 'd' });",
        "    ShapeBridge.readObject({ field: 'profile' });",
        "  }",
        "}",
      ].join("\n"),
    },
    samples: [
      ruleSample("SF331-RULE-SINK-010", "sendAll", "ShapeBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "complex", "rest argument payload sink"),
      ruleSample("SF331-RULE-SINK-011", "sendObject", "ShapeBridge.ets", "sink", ["rule.sink"], endpoint("arg", 0), "complex", "object shape payload sink"),
      ruleSample("SF331-RULE-SOURCE-006", "readObject", "ShapeBridge.ets", "source", ["rule.source"], endpoint("return"), "complex", "object-shape source wrapper"),
    ],
  },
];

function endpoint(kind, index) {
  if (kind === "return") return { base: { kind: "return" } };
  if (kind === "promiseResult") return { base: { kind: "promiseResult" } };
  if (kind === "receiver") return { base: { kind: "receiver" } };
  return { base: { kind, index } };
}

function ruleSample(sampleId, method, fileNeedle, role, effectKinds, expectedEndpoint, complexity, notes) {
  return {
    sampleId,
    candidateType: "api",
    expectedDecision: "done",
    expectedPlane: "rule",
    expectedRole: role,
    expectedEffectKinds: effectKinds,
    expectedEndpoint,
    method,
    fileNeedle,
    complexity,
    notes,
  };
}

function moduleSample(sampleId, method, fileNeedle, effectKinds, notes) {
  return {
    sampleId,
    candidateType: method === "on" ? "callback-api" : "api",
    expectedDecision: "done",
    expectedPlane: "module",
    expectedRole: "handoff",
    expectedEffectKinds: effectKinds,
    expectedEndpoint: null,
    method,
    fileNeedle,
    complexity: "complex",
    notes,
  };
}

function arkMainSample(sampleId, method, notes, expectedEntryKind) {
  return {
    sampleId,
    candidateType: "arkmain",
    expectedDecision: "done",
    expectedPlane: "arkmain",
    expectedRole: "entry",
    expectedEffectKinds: ["entry.lifecycle"],
    expectedEndpoint: null,
    method,
    fileNeedle: "",
    complexity: "medium",
    notes,
    expectedEntryKind,
  };
}

function negativeSample(sampleId, method, fileNeedle, notes) {
  return {
    sampleId,
    candidateType: "api",
    expectedDecision: "reject",
    expectedPlane: null,
    expectedRole: "none",
    expectedEffectKinds: [],
    expectedEndpoint: null,
    method,
    fileNeedle,
    complexity: "negative",
    notes,
    negativeReason: notes,
  };
}

function main() {
  ensureSafeOutputRoot();
  fs.rmSync(outputRoot, { recursive: true, force: true });
  for (const dir of ["scenarios", "slices", "prompts", "oracle", "requests", "manifests", "summaries", "gaps"]) {
    fs.mkdirSync(path.join(outputRoot, dir), { recursive: true });
  }

  const rows = [];
  const jsonlRows = [];
  const llmRequests = [];
  const gaps = [];
  const summary = {
    generatedAt: new Date().toISOString(),
    outputRoot: rel(outputRoot),
    scenarios: scenarios.length,
    baseSamplesReady: 0,
    baseSamplesMissing: 0,
    requestCount: 0,
    byPlane: {},
    byRole: {},
    byVariant: {},
    byComplexity: {},
  };

  for (const scenario of scenarios) {
    const projectDir = path.join(outputRoot, "scenarios", scenario.id, "project");
    writeScenarioProject(projectDir, scenario.files);
    writeText(path.join(outputRoot, "scenarios", scenario.id, "README.md"), scenarioReadme(scenario));

    const discovery = discoverScenario(projectDir);
    const exactCandidates = [...discovery.apiCandidates, ...discovery.callbackCandidates]
      .filter(candidate => !!candidate.canonicalApiId);
    const apiItems = exactCandidates.map(candidate => buildSemanticFlowApiModelingCandidateItem(candidate, {
      maxContextSlices: 2,
      companionCandidates: exactCandidates,
    }));
    const arkMainItems = discovery.arkMainCandidates.map(candidate => ({
      candidate,
      item: buildSemanticFlowArkMainCandidateItem(candidate),
    }));

    for (const spec of scenario.samples) {
      const resolved = resolveSampleItem(spec, exactCandidates, apiItems, arkMainItems);
      if (!resolved) {
        gaps.push({
          sampleId: spec.sampleId,
          scenarioId: scenario.id,
          method: spec.method,
          fileNeedle: spec.fileNeedle,
          expectedPlane: spec.expectedPlane,
          expectedRole: spec.expectedRole,
          reason: "engine_candidate_not_found_or_not_exact",
          availableExactCandidates: exactCandidates.map(condenseCandidate),
          arkMainCandidates: discovery.arkMainCandidates.map(condenseArkMainCandidate),
        });
        summary.baseSamplesMissing++;
        continue;
      }

      const baseSample = {
        ...spec,
        scenarioId: scenario.id,
        sourceProjectDir: rel(projectDir),
        anchor: sanitizeAnchor(resolved.item.anchor),
        fullSlice: resolved.item.initialSlice,
        engineCandidateSummary: resolved.candidateSummary,
      };
      const oracle = buildOracle(baseSample);
      const oraclePath = path.join(outputRoot, "oracle", `${spec.sampleId}.oracle.json`);
      writeJson(oraclePath, oracle);
      const fullSlicePath = path.join(outputRoot, "slices", `${spec.sampleId}.full_slice.json`);
      writeJson(fullSlicePath, {
        sampleId: spec.sampleId,
        scenarioId: scenario.id,
        item: {
          anchor: sanitizeAnchor(resolved.item.anchor),
          initialSlice: resolved.item.initialSlice,
        },
        engineCandidateSummary: resolved.candidateSummary,
      });

      summary.baseSamplesReady++;
      inc(summary.byPlane, spec.expectedPlane || "none");
      inc(summary.byRole, spec.expectedRole);
      inc(summary.byComplexity, spec.complexity);

      for (const variant of VARIANTS.filter(item => item.appliesTo(spec))) {
        const variantId = `${spec.sampleId}__${variant.id}`;
        const mutated = variant.mutate(resolved.item, spec);
        const prompt = buildSemanticFlowPrompt({
          anchor: mutated.anchor,
          draftId: `draft.${variantId}`,
          slice: mutated.slice,
          round: 0,
          history: [],
        });
        const promptPath = path.join(outputRoot, "prompts", `${variantId}.prompt.json`);
        const slicePath = path.join(outputRoot, "slices", `${variantId}.slice.json`);
        writeJson(promptPath, {
          sampleId: spec.sampleId,
          variantId: variant.id,
          variantLabel: variant.label,
          system: prompt.system,
          user: prompt.user,
        });
        writeJson(slicePath, {
          sampleId: spec.sampleId,
          variantId: variant.id,
          anchor: sanitizeAnchor(mutated.anchor),
          slice: mutated.slice,
        });
        const request = {
          requestId: variantId,
          sampleId: spec.sampleId,
          scenarioId: scenario.id,
          variantId: variant.id,
          recommendedProfile: "deepseek-v4-pro",
          profileReady: true,
          system: prompt.system,
          user: prompt.user,
          oraclePath: rel(oraclePath),
          slicePath: rel(slicePath),
          promptPath: rel(promptPath),
        };
        llmRequests.push(request);
        summary.requestCount++;
        inc(summary.byVariant, variant.id);
      }

      const row = {
        sample_id: spec.sampleId,
        scenario_id: scenario.id,
        expected_decision: spec.expectedDecision,
        expected_plane: spec.expectedPlane || "none",
        expected_role: spec.expectedRole,
        expected_effect_kinds: spec.expectedEffectKinds.join(";"),
        complexity_level: spec.complexity,
        scenario_family: scenario.id,
        slice_template: resolved.item.initialSlice.template,
        source_project_dir: rel(projectDir),
        full_slice_path: rel(fullSlicePath),
        oracle_path: rel(oraclePath),
        llm_ready: "true",
        negative_type: spec.negativeReason || "",
        manual_oracle_status: "checked",
        notes: spec.notes,
      };
      rows.push(row);
      jsonlRows.push({
        ...row,
        sourceFiles: Object.keys(scenario.files).map(file => rel(path.join(projectDir, file))),
        engineCandidateSummary: resolved.candidateSummary,
        anchor: sanitizeAnchor(resolved.item.anchor),
        slice: resolved.item.initialSlice,
        oraclePath: rel(oraclePath),
      });
    }
  }

  writeCsv(path.join(outputRoot, "semanticflow_331_manifest.csv"), rows);
  writeJsonl(path.join(outputRoot, "semanticflow_331_manifest.jsonl"), jsonlRows);
  const rootRequestQueuePath = path.join(outputRoot, "llm_requests.jsonl");
  const requestQueuePath = path.join(outputRoot, "requests", "llm_requests.jsonl");
  writeJsonl(rootRequestQueuePath, llmRequests);
  writeJsonl(requestQueuePath, llmRequests);
  writeJson(path.join(outputRoot, "manifests", "dataset_manifest.json"), {
    datasetId: "semanticflow_331_evidence_ablation",
    generatedAt: summary.generatedAt,
    outputRoot: rel(outputRoot),
    baseSampleCount: summary.baseSamplesReady,
    requestCount: summary.requestCount,
    scenarioCount: scenarios.length,
    requestQueuePath: rel(requestQueuePath),
    compatibilityRequestQueuePath: rel(rootRequestQueuePath),
    variants: VARIANTS.map(({ id, label }) => ({ id, label })),
    builder: rel(path.join(repoRoot, "tools/chapter3/build_331_evidence_ablation_dataset.js")),
  });
  writeJson(path.join(outputRoot, "gaps", "engine_candidate_gaps.json"), gaps);
  writeText(path.join(outputRoot, "reusable_prompt_template.md"), reusablePromptTemplate());
  writeText(path.join(outputRoot, "summaries", "summary.md"), renderSummary(summary, gaps));
  writeJson(path.join(outputRoot, "summaries", "summary.json"), summary);
  writeText(path.join(outputRoot, "build_log.md"), renderBuildLog(summary, gaps));

  console.log(JSON.stringify({
    outputRoot,
    baseSamplesReady: summary.baseSamplesReady,
    baseSamplesMissing: summary.baseSamplesMissing,
    requestCount: summary.requestCount,
    gaps: gaps.length,
    byPlane: summary.byPlane,
    byRole: summary.byRole,
    byVariant: summary.byVariant,
  }, null, 2));
}

function ensureSafeOutputRoot() {
  const normalized = outputRoot.replace(/\\/g, "/");
  if (!normalized.includes("/internal_docs/reports/chapter3_experiment_artifacts/final/datasets/semanticflow_331_evidence_ablation")) {
    throw new Error(`unsafe output root: ${outputRoot}`);
  }
}

function writeScenarioProject(projectDir, files) {
  fs.rmSync(projectDir, { recursive: true, force: true });
  for (const [relativePath, content] of Object.entries(files)) {
    writeText(path.join(projectDir, relativePath), content);
  }
}

function discoverScenario(projectDir) {
  const apiCandidates = discoverApiSurfaceModelingCandidates(projectDir, SOURCE_DIRS, { maxCandidates: 120 });
  const callbackCandidates = discoverApiCallbackModelingCandidates(projectDir, SOURCE_DIRS, { maxCandidates: 120 });
  const arkMainCandidates = buildArkMainCandidates(projectDir);
  return { apiCandidates, callbackCandidates, arkMainCandidates };
}

function buildArkMainCandidates(projectDir) {
  try {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return buildArkMainEntryCandidates(scene, { maxCandidates: 32 });
  } catch (error) {
    return [];
  }
}

function resolveSampleItem(spec, exactCandidates, apiItems, arkMainItems) {
  if (spec.candidateType === "arkmain") {
    const match = arkMainItems.find(({ candidate }) => candidate.methodName === spec.method);
    if (!match) return undefined;
    return {
      item: match.item,
      candidateSummary: condenseArkMainCandidate(match.candidate),
    };
  }
  const candidates = exactCandidates
    .map((candidate, index) => ({ candidate, item: apiItems[index] }))
    .filter(({ candidate }) => candidate.method === spec.method)
    .filter(({ candidate }) => !spec.fileNeedle || normalizeSlash(candidate.sourceFile).includes(spec.fileNeedle));
  if (candidates.length === 0) return undefined;
  const preferred = candidates.find(({ candidate }) => {
    if (spec.candidateType === "callback-api") return candidate.candidateOrigin === "recall_method_callback_surface";
    return candidate.candidateOrigin !== "recall_method_callback_surface";
  }) || candidates[0];
  return {
    item: preferred.item,
    candidateSummary: condenseCandidate(preferred.candidate),
  };
}

function buildOracle(sample) {
  return {
    sampleId: sample.sampleId,
    scenarioId: sample.scenarioId,
    sourceProjectDir: sample.sourceProjectDir,
    expectedDecision: sample.expectedDecision,
    expectedPlane: sample.expectedPlane,
    expectedSemanticRole: sample.expectedRole,
    expectedEffectKinds: sample.expectedEffectKinds,
    expectedEndpoint: sample.expectedEndpoint,
    expectedIdentityRequired: sample.expectedDecision === "done",
    expectedNegativeReason: sample.negativeReason || null,
    expectedEntryKind: sample.expectedEntryKind || null,
    expectedEndpointSemantics: sample.notes,
    mustUseCanonicalApiSurface: sample.expectedDecision === "done",
    mustNotContain: [
      "fallback",
      "version",
      "selector",
      "methodName as surface identity",
      "modulePath as surface identity",
      "argCount as surface identity",
    ],
    manualReviewNotes: "Oracle is assigned after reading the generated scenario source and engine-produced SemanticFlow slice.",
    engineCandidateSummary: sample.engineCandidateSummary,
  };
}

function identityVariant(item) {
  return cloneDecisionInput(item);
}

function makeNameSignatureOnly(item) {
  const cloned = cloneDecisionInput(item);
  cloned.anchor = stripAnchorIdentity(cloned.anchor);
  cloned.anchor.surface = readableSurface(cloned.anchor);
  cloned.slice = {
    ...cloned.slice,
    observations: (cloned.slice.observations || [])
      .filter(line => /^(signature|method|class|filePath|returnType|parameterCount|parameterTypes)=/.test(line))
      .slice(0, 6),
    snippets: [],
    companions: [],
    notes: [],
  };
  return cloned;
}

function makeIdentityOnly(item) {
  const cloned = cloneDecisionInput(item);
  cloned.slice = {
    ...cloned.slice,
    observations: (cloned.slice.observations || []).filter(line => line.includes("canonicalApiSurface") || line.startsWith("canonicalApiId=")),
    snippets: (cloned.slice.snippets || []).filter(snippet => String(snippet.label || "").includes("canonical")),
    companions: [],
    notes: [],
  };
  return cloned;
}

function makeNoCallsite(item) {
  const cloned = cloneDecisionInput(item);
  cloned.slice = {
    ...cloned.slice,
    observations: (cloned.slice.observations || []).filter(line => !line.startsWith("contextSlices=")),
    snippets: (cloned.slice.snippets || []).filter(snippet => !String(snippet.label || "").startsWith("callsite")),
  };
  return cloned;
}

function makeNoMethodSnippet(item) {
  const cloned = cloneDecisionInput(item);
  cloned.slice = {
    ...cloned.slice,
    observations: (cloned.slice.observations || []).filter(line => line !== "methodSnippet=available" && !line.startsWith("formalParam=")),
    snippets: (cloned.slice.snippets || []).filter(snippet => !["method", "owner-context"].includes(String(snippet.label || ""))),
  };
  return cloned;
}

function makeNoCompanion(item) {
  const cloned = cloneDecisionInput(item);
  cloned.slice = {
    ...cloned.slice,
    observations: (cloned.slice.observations || []).filter(line => !line.startsWith("companion")),
    snippets: (cloned.slice.snippets || []).filter(snippet => !String(snippet.label || "").startsWith("companion")),
    companions: [],
  };
  return cloned;
}

function makeNoExactIdentity(item) {
  const cloned = cloneDecisionInput(item);
  cloned.anchor = stripAnchorIdentity(cloned.anchor);
  cloned.anchor.surface = readableSurface(cloned.anchor);
  cloned.slice = {
    ...cloned.slice,
    observations: stripIdentityLines(cloned.slice.observations || []),
    snippets: (cloned.slice.snippets || []).map(snippet => ({
      ...snippet,
      code: stripIdentityText(String(snippet.code || "")),
    })).filter(snippet => !String(snippet.label || "").includes("canonical")),
    companions: stripIdentityLines(cloned.slice.companions || []),
    notes: stripIdentityLines(cloned.slice.notes || []),
  };
  return cloned;
}

function makeNoOfficialEntryEvidence(item) {
  const cloned = cloneDecisionInput(item);
  cloned.slice = {
    ...cloned.slice,
    observations: (cloned.slice.observations || []).filter(line =>
      !line.startsWith("officialDeclaration")
      && !line.startsWith("frameworkSignal")
      && !line.startsWith("frameworkSignals=")),
    snippets: (cloned.slice.snippets || []).filter(snippet => String(snippet.label || "") !== "official-entry-declarations"),
  };
  return cloned;
}

function cloneDecisionInput(item) {
  return {
    anchor: JSON.parse(JSON.stringify(sanitizeAnchor(item.anchor))),
    slice: JSON.parse(JSON.stringify(item.initialSlice)),
  };
}

function stripAnchorIdentity(anchor) {
  const cloned = { ...anchor };
  delete cloned.canonicalApiId;
  return cloned;
}

function stripIdentityLines(lines) {
  return lines
    .map(stripIdentityText)
    .filter(line => line.trim().length > 0);
}

function stripIdentityText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(line => !line.includes("canonicalApiSurface") && !line.startsWith("canonicalApiId="))
    .join("\n");
}

function readableSurface(anchor) {
  const signature = String(anchor.methodSignature || "");
  const match = signature.match(/:\s*([A-Za-z0-9_$.]+)\((.*?)\)/);
  return match ? match[1] : String(anchor.owner || "unknown") + "." + String(anchor.surface || "unknown");
}

function sanitizeAnchor(anchor) {
  const { method, ...rest } = anchor || {};
  void method;
  return rest;
}

function condenseCandidate(candidate) {
  return {
    method: candidate.method,
    sourceFile: normalizeSlash(candidate.sourceFile || ""),
    candidateOrigin: candidate.candidateOrigin || "",
    canonicalApiId: candidate.canonicalApiId || "",
    argCount: candidate.argCount,
    returnType: candidate.returnType || "",
    templateHint: candidate.semanticFocus || candidate.typeHint || "",
    topEntries: candidate.topEntries || [],
  };
}

function condenseArkMainCandidate(candidate) {
  return {
    methodName: candidate.methodName,
    className: candidate.className,
    filePath: normalizeSlash(candidate.filePath || ""),
    parameterTypes: candidate.parameterTypes,
    returnType: candidate.returnType || "",
    ownerSignals: candidate.ownerSignals || [],
    frameworkSignals: candidate.frameworkSignals || [],
  };
}

function scenarioReadme(scenario) {
  return [
    `# ${scenario.id}`,
    "",
    "This scenario is generated for Chapter 3.3.1 evidence-ablation dataset construction.",
    "The source code is synthetic but follows ArkTS/Harmony project structure.",
    "SemanticFlow slices must be produced by the current ArkTaint engine; do not manually edit generated slices.",
    "",
    "Expected samples:",
    ...scenario.samples.map(sample => `- ${sample.sampleId}: ${sample.expectedPlane || "none"} / ${sample.expectedRole} / ${sample.method}`),
    "",
  ].join("\n");
}

function reusablePromptTemplate() {
  return [
    "# Chapter 3.3.1 Reusable LLM Request Template",
    "",
    "Prompts in this dataset are generated by `buildSemanticFlowPrompt` from engine-produced SemanticFlow slices.",
    "Do not manually copy individual slices into ad hoc prompts.",
    "",
    "Use `requests/llm_requests.jsonl` as the request queue. A compatibility copy is also written to `llm_requests.jsonl`.",
    "Each record contains:",
    "",
    "- `requestId`",
    "- `sampleId`",
    "- `variantId`",
    "- `recommendedProfile`",
    "- `system`",
    "- `user`",
    "- `oraclePath`",
    "- `slicePath`",
    "",
    "The later runner should send `system` and `user` exactly as recorded, then compare the model output against the oracle.",
    "This builder does not execute LLM calls.",
    "",
  ].join("\n");
}

function renderSummary(summary, gaps) {
  const gapLines = gaps.length === 0
    ? ["- None."]
    : gaps.map(gap => `- ${gap.sampleId}: ${gap.reason} (${gap.scenarioId}/${gap.method})`);

  return [
    "# SemanticFlow 3.3.1 Evidence Ablation Dataset",
    "",
    `Generated at: ${summary.generatedAt}`,
    "",
    "## Counts",
    "",
    `- Scenarios: ${summary.scenarios}`,
    `- LLM-ready base samples: ${summary.baseSamplesReady}`,
    `- Missing/gap base samples: ${summary.baseSamplesMissing}`,
    `- LLM request records: ${summary.requestCount}`,
    "",
    "## Distribution",
    "",
    "By plane:",
    ...Object.entries(summary.byPlane).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "By role:",
    ...Object.entries(summary.byRole).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "By variant:",
    ...Object.entries(summary.byVariant).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Gaps",
    "",
    ...gapLines,
    "",
  ].join("\n");
}

function renderBuildLog(summary, gaps) {
  return [
    "# Build Log",
    "",
    `Builder: tools/chapter3/build_331_evidence_ablation_dataset.js`,
    `Generated at: ${summary.generatedAt}`,
    `Output root: ${summary.outputRoot}`,
    "",
    "The dataset is constructed from generated ArkTS/Harmony-style scenario projects.",
    "All LLM-ready slices are produced by the current ArkTaint SemanticFlow engine.",
    "No LLM execution is performed by this builder.",
    "",
    `Ready samples: ${summary.baseSamplesReady}`,
    `Missing samples: ${summary.baseSamplesMissing}`,
    `Request records: ${summary.requestCount}`,
    "",
    "Gap file: gaps/engine_candidate_gaps.json",
    "",
    gaps.length > 0 ? "Some desired samples were not selected by the current engine and were recorded as gaps." : "No desired sample gaps were recorded.",
    "",
  ].join("\n");
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2) + "\n");
}

function writeJsonl(file, rows) {
  writeText(file, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function writeCsv(file, rows) {
  if (rows.length === 0) {
    writeText(file, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map(header => csvCell(row[header])).join(","));
  }
  writeText(file, lines.join("\n") + "\n");
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function rel(file) {
  return normalizeSlash(path.relative(repoRoot, file));
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function inc(map, key) {
  const normalized = String(key || "none");
  map[normalized] = (map[normalized] || 0) + 1;
}

main();
