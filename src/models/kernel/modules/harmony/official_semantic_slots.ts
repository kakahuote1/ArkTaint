import type {
    AssetBinding,
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurface,
    HandoffGetTemplate,
    HandoffHandleTemplate,
    HandoffKillTemplate,
    HandoffPutTemplate,
    HandleKeyPartTemplate,
    InvokeSurface,
} from "../../../../core/assets/schema";
import { moduleInvokeSurface } from "../../moduleAssetHelpers";

type HandoffTemplate = HandoffPutTemplate | HandoffGetTemplate | HandoffKillTemplate;

interface OfficialHandoffMethod {
    methodId: string;
    ownerName: string;
    methodName: string;
    argCount: number;
    invokeKind?: InvokeSurface["invokeKind"];
    modulePath: string;
    effects: HandoffTemplate[];
    description: string;
}

interface OfficialHandoffAssetInput {
    id: string;
    description: string;
    semanticsFamily: string;
    methods: OfficialHandoffMethod[];
}

const arg = (index: number, accessPath?: string[]): AssetEndpoint => ({
    base: { kind: "arg", index },
    ...(accessPath && accessPath.length > 0 ? { accessPath } : {}),
});
const ret = (accessPath?: string[]): AssetEndpoint => ({
    base: { kind: "return" },
    ...(accessPath && accessPath.length > 0 ? { accessPath } : {}),
});
const receiver = (accessPath?: string[]): AssetEndpoint => ({
    base: { kind: "receiver" },
    ...(accessPath && accessPath.length > 0 ? { accessPath } : {}),
});
const promiseResult = (accessPath?: string[]): AssetEndpoint => ({
    base: { kind: "promiseResult" },
    ...(accessPath && accessPath.length > 0 ? { accessPath } : {}),
});
const callbackArg = (callbackArgIndex: number, argIndex: number, accessPath?: string[]): AssetEndpoint => ({
    base: {
        kind: "callbackArg",
        callback: { kind: "arg", index: callbackArgIndex },
        argIndex,
    },
    ...(accessPath && accessPath.length > 0 ? { accessPath } : {}),
});

const constKey = (value: string): HandleKeyPartTemplate => ({ kind: "const", value });
const unknownKey = (): HandleKeyPartTemplate => ({ kind: "unknown" });
const endpointKey = (endpoint: AssetEndpoint): HandleKeyPartTemplate => ({ kind: "fromEndpoint", endpoint });
const endpointPathKey = (endpoint: AssetEndpoint, accessPath: string[]): HandleKeyPartTemplate => ({
    kind: "fromEndpointPath",
    endpoint,
    accessPath,
});

function handle(
    cellKind: HandoffHandleTemplate["cellKind"],
    family: string,
    key: HandleKeyPartTemplate[],
    options: {
        scope?: HandleKeyPartTemplate[];
        owner?: HandleKeyPartTemplate[];
        precision?: HandoffHandleTemplate["precision"];
    } = {},
): HandoffHandleTemplate {
    return {
        cellKind,
        family,
        key,
        ...(options.scope ? { scope: options.scope } : {}),
        ...(options.owner ? { owner: options.owner } : {}),
        precision: options.precision || "infer",
    };
}

function put(
    id: string,
    targetHandle: HandoffHandleTemplate,
    value: AssetEndpoint,
    updateStrength: HandoffPutTemplate["updateStrength"] = "infer",
): HandoffPutTemplate {
    return {
        id,
        kind: "handoff.put",
        handle: targetHandle,
        value,
        updateStrength,
        confidence: "certain",
    };
}

function get(id: string, sourceHandle: HandoffHandleTemplate, target: AssetEndpoint): HandoffGetTemplate {
    return {
        id,
        kind: "handoff.get",
        handle: sourceHandle,
        target,
        confidence: "certain",
    };
}

function kill(
    id: string,
    targetHandle: HandoffHandleTemplate,
    updateStrength: HandoffKillTemplate["updateStrength"] = "strong",
): HandoffKillTemplate {
    return {
        id,
        kind: "handoff.kill",
        handle: targetHandle,
        updateStrength,
        confidence: "certain",
    };
}

function makeOfficialHandoffAsset(input: OfficialHandoffAssetInput): AssetDocumentBase {
    const surfaces: AssetSurface[] = input.methods.map(method =>
        moduleInvokeSurface(
            `${input.id}.${method.methodId}`,
            method.ownerName,
            method.methodName,
            method.argCount,
            method.invokeKind || "instance",
            method.modulePath,
        ),
    );
    const bindings: AssetBinding[] = input.methods.map((method, index) => ({
        bindingId: `binding.${input.id}.${method.methodId}`,
        surfaceId: surfaces[index].surfaceId,
        assetId: input.id,
        plane: "module",
        role: "handoff",
        endpoint: endpointForEffects(method.effects),
        effectTemplateRefs: method.effects.map(effect => effect.id),
        semanticsFamily: input.semanticsFamily,
        metadata: {
            description: method.description,
        },
        completeness: "complete",
        confidence: "certain",
    }));
    const effectTemplates = input.methods.flatMap(method => method.effects);
    return {
        id: input.id,
        plane: "module",
        status: "official",
        surfaces,
        bindings,
        effectTemplates,
        provenance: {
            source: "builtin",
            evidenceLocations: [
                { file: "internal_docs/security_asset_iteration/official_transfer_model_semantic_todo.md" },
                { file: "internal_docs/security_asset_iteration/official_transfer_model_sdk_crosscheck_report.md" },
            ],
        },
    };
}

function endpointForEffects(effects: HandoffTemplate[]): AssetEndpoint | undefined {
    const first = effects[0];
    if (!first) return undefined;
    if (first.kind === "handoff.put") return first.value;
    if (first.kind === "handoff.get") return first.target;
    return undefined;
}

const fileSlot = (keyEndpoint: AssetEndpoint) => handle(
    "persistent-storage-slot",
    "harmony.file_uri",
    [endpointKey(keyEndpoint)],
    { precision: "infer" },
);

const rdbSlot = (keyEndpoint: AssetEndpoint) => handle(
    "persistent-storage-slot",
    "harmony.rdb_datashare",
    [endpointKey(keyEndpoint)],
    { precision: "infer" },
);

const clipboardSlot = () => handle(
    "persistent-storage-slot",
    "harmony.clipboard",
    [constKey("primary")],
    { precision: "exact" },
);

const webviewCredentialSlot = (kind: "username" | "password") => handle(
    "resource-handle-slot",
    "harmony.webview.http_auth",
    [endpointKey(arg(0)), endpointKey(arg(1)), constKey(kind)],
    { precision: "infer" },
);

const notificationSlot = (key: HandleKeyPartTemplate[]) => handle(
    "global-context-slot",
    "harmony.notification_form",
    key,
    { precision: "infer" },
);

const mediaSlot = () => handle(
    "resource-handle-slot",
    "harmony.media_resource",
    [endpointKey(receiver())],
    { precision: "infer" },
);

const commonEventSlot = () => handle(
    "message-channel-slot",
    "harmony.common_event",
    [endpointKey(arg(0))],
    { precision: "infer" },
);

const securityAssetSlot = (key: HandleKeyPartTemplate[]) => handle(
    "persistent-storage-slot",
    "harmony.security_asset",
    key,
    { precision: "infer" },
);

const wantParamSlot = (key: HandleKeyPartTemplate[]) => handle(
    "navigation-param-slot",
    "harmony.want_parameters",
    key,
    { owner: [endpointKey(receiver())], precision: "infer" },
);

const messageParcelSlot = () => handle(
    "message-channel-slot",
    "harmony.message_parcel",
    [constKey("payload")],
    { owner: [endpointKey(receiver())], precision: "infer" },
);

const fileUriAsset = makeOfficialHandoffAsset({
    id: "harmony.file_uri",
    description: "Official Harmony file path and URI content state semantics.",
    semanticsFamily: "harmony-file-uri-state",
    methods: [
        {
            methodId: "fs.writeText",
            ownerName: "fs",
            methodName: "writeText",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 2,
            effects: [put("template.harmony.file_uri.fs.writeText.put", fileSlot(arg(0)), arg(1), "strong")],
            description: "fs.writeText(path, text) stores text content into the path cell.",
        },
        {
            methodId: "fs.writeTextSync",
            ownerName: "fs",
            methodName: "writeTextSync",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 2,
            effects: [put("template.harmony.file_uri.fs.writeTextSync.put", fileSlot(arg(0)), arg(1), "strong")],
            description: "fs.writeTextSync(path, text) stores text content into the path cell.",
        },
        {
            methodId: "fileIo.writeText",
            ownerName: "fileIo",
            methodName: "writeText",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 2,
            effects: [put("template.harmony.file_uri.fileIo.writeText.put", fileSlot(arg(0)), arg(1), "strong")],
            description: "fileIo.writeText(path, text) stores text content into the path cell.",
        },
        {
            methodId: "fs.readText",
            ownerName: "fs",
            methodName: "readText",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 1,
            effects: [get("template.harmony.file_uri.fs.readText.get", fileSlot(arg(0)), promiseResult())],
            description: "fs.readText(path) loads text content from the path cell.",
        },
        {
            methodId: "fs.readTextSync",
            ownerName: "fs",
            methodName: "readTextSync",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 1,
            effects: [get("template.harmony.file_uri.fs.readTextSync.get", fileSlot(arg(0)), ret())],
            description: "fs.readTextSync(path) loads text content from the path cell.",
        },
        {
            methodId: "fileIo.readText",
            ownerName: "fileIo",
            methodName: "readText",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 1,
            effects: [get("template.harmony.file_uri.fileIo.readText.get", fileSlot(arg(0)), promiseResult())],
            description: "fileIo.readText(path) loads text content from the path cell.",
        },
        {
            methodId: "fs.unlink",
            ownerName: "fs",
            methodName: "unlink",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 1,
            effects: [kill("template.harmony.file_uri.fs.unlink.kill", fileSlot(arg(0)))],
            description: "fs.unlink(path) invalidates the path content cell.",
        },
        {
            methodId: "fs.truncate",
            ownerName: "fs",
            methodName: "truncate",
            invokeKind: "namespace",
            modulePath: "@ohos.file.fs",
            argCount: 1,
            effects: [kill("template.harmony.file_uri.fs.truncate.kill", fileSlot(arg(0)))],
            description: "fs.truncate(path) invalidates the path content cell.",
        },
    ],
});

const rdbDataShareAsset = makeOfficialHandoffAsset({
    id: "harmony.rdb_datashare",
    description: "Official Harmony relational store and DataShare row state semantics.",
    semanticsFamily: "harmony-rdb-datashare-state",
    methods: [
        {
            methodId: "RdbStore.insert",
            ownerName: "RdbStore",
            methodName: "insert",
            modulePath: "@ohos.data.relationalStore",
            argCount: 2,
            effects: [put("template.harmony.rdb_datashare.RdbStore.insert.put", rdbSlot(arg(0)), arg(1), "infer")],
            description: "RdbStore.insert(table, valuesBucket) stores row values in the table cell.",
        },
        {
            methodId: "RdbStore.update",
            ownerName: "RdbStore",
            methodName: "update",
            modulePath: "@ohos.data.relationalStore",
            argCount: 3,
            effects: [put("template.harmony.rdb_datashare.RdbStore.update.put", rdbSlot(arg(0)), arg(1), "infer")],
            description: "RdbStore.update(table, valuesBucket, predicates) stores updated row values in the table cell.",
        },
        {
            methodId: "RdbStore.querySql",
            ownerName: "RdbStore",
            methodName: "querySql",
            modulePath: "@ohos.data.relationalStore",
            argCount: 1,
            effects: [get("template.harmony.rdb_datashare.RdbStore.querySql.get", rdbSlot(arg(0)), promiseResult())],
            description: "RdbStore.querySql(sql) returns result rows associated with the SQL state key.",
        },
        {
            methodId: "RdbStore.query",
            ownerName: "RdbStore",
            methodName: "query",
            modulePath: "@ohos.data.relationalStore",
            argCount: 2,
            effects: [get("template.harmony.rdb_datashare.RdbStore.query.get", rdbSlot(arg(0)), promiseResult())],
            description: "RdbStore.query(predicates, columns) returns result rows associated with the predicate key.",
        },
        {
            methodId: "RdbStore.delete",
            ownerName: "RdbStore",
            methodName: "delete",
            modulePath: "@ohos.data.relationalStore",
            argCount: 2,
            effects: [kill("template.harmony.rdb_datashare.RdbStore.delete.kill", rdbSlot(arg(0)), "infer")],
            description: "RdbStore.delete(table, predicates) invalidates row state for the table key.",
        },
        {
            methodId: "DataShareHelper.insert",
            ownerName: "DataShareHelper",
            methodName: "insert",
            modulePath: "@ohos.data.dataShare",
            argCount: 2,
            effects: [put("template.harmony.rdb_datashare.DataShareHelper.insert.put", rdbSlot(arg(0)), arg(1), "infer")],
            description: "DataShareHelper.insert(uri, valuesBucket) stores values in the URI-backed data cell.",
        },
        {
            methodId: "DataShareHelper.update",
            ownerName: "DataShareHelper",
            methodName: "update",
            modulePath: "@ohos.data.dataShare",
            argCount: 3,
            effects: [put("template.harmony.rdb_datashare.DataShareHelper.update.put", rdbSlot(arg(0)), arg(1), "infer")],
            description: "DataShareHelper.update(uri, valuesBucket, predicates) stores values in the URI-backed data cell.",
        },
        {
            methodId: "DataShareHelper.query",
            ownerName: "DataShareHelper",
            methodName: "query",
            modulePath: "@ohos.data.dataShare",
            argCount: 3,
            effects: [get("template.harmony.rdb_datashare.DataShareHelper.query.get", rdbSlot(arg(0)), promiseResult())],
            description: "DataShareHelper.query(uri, predicates, columns) returns rows from the URI-backed data cell.",
        },
        {
            methodId: "DataShareHelper.delete",
            ownerName: "DataShareHelper",
            methodName: "delete",
            modulePath: "@ohos.data.dataShare",
            argCount: 2,
            effects: [kill("template.harmony.rdb_datashare.DataShareHelper.delete.kill", rdbSlot(arg(0)), "infer")],
            description: "DataShareHelper.delete(uri, predicates) invalidates row state for the URI-backed data cell.",
        },
    ],
});

const clipboardAsset = makeOfficialHandoffAsset({
    id: "harmony.clipboard_unifieddata",
    description: "Official Harmony pasteboard and UnifiedData state semantics.",
    semanticsFamily: "harmony-clipboard-unifieddata-state",
    methods: [
        {
            methodId: "SystemPasteboard.setData",
            ownerName: "SystemPasteboard",
            methodName: "setData",
            modulePath: "@ohos.pasteboard",
            argCount: 1,
            effects: [put("template.harmony.clipboard.SystemPasteboard.setData.put", clipboardSlot(), arg(0), "strong")],
            description: "SystemPasteboard.setData(data) stores clipboard data.",
        },
        {
            methodId: "SystemPasteboard.setPasteData",
            ownerName: "SystemPasteboard",
            methodName: "setPasteData",
            modulePath: "@ohos.pasteboard",
            argCount: 1,
            effects: [put("template.harmony.clipboard.SystemPasteboard.setPasteData.put", clipboardSlot(), arg(0), "strong")],
            description: "SystemPasteboard.setPasteData(data) stores clipboard data.",
        },
        {
            methodId: "SystemPasteboard.getData",
            ownerName: "SystemPasteboard",
            methodName: "getData",
            modulePath: "@ohos.pasteboard",
            argCount: 0,
            effects: [get("template.harmony.clipboard.SystemPasteboard.getData.get", clipboardSlot(), promiseResult())],
            description: "SystemPasteboard.getData() loads clipboard data.",
        },
        {
            methodId: "SystemPasteboard.getPasteData",
            ownerName: "SystemPasteboard",
            methodName: "getPasteData",
            modulePath: "@ohos.pasteboard",
            argCount: 0,
            effects: [get("template.harmony.clipboard.SystemPasteboard.getPasteData.get", clipboardSlot(), promiseResult())],
            description: "SystemPasteboard.getPasteData() loads clipboard data.",
        },
        {
            methodId: "SystemPasteboard.clear",
            ownerName: "SystemPasteboard",
            methodName: "clear",
            modulePath: "@ohos.pasteboard",
            argCount: 0,
            effects: [kill("template.harmony.clipboard.SystemPasteboard.clear.kill", clipboardSlot())],
            description: "SystemPasteboard.clear() invalidates clipboard data.",
        },
    ],
});

const webviewBridgeAsset = makeOfficialHandoffAsset({
    id: "harmony.webview_bridge_state",
    description: "Official Harmony WebView credential bridge state semantics.",
    semanticsFamily: "harmony-webview-bridge-state",
    methods: [
        {
            methodId: "WebviewController.saveHttpAuthCredentials",
            ownerName: "WebviewController",
            methodName: "saveHttpAuthCredentials",
            modulePath: "@ohos.web.webview",
            argCount: 4,
            effects: [
                put("template.harmony.webview.saveHttpAuthCredentials.username.put", webviewCredentialSlot("username"), arg(2), "strong"),
                put("template.harmony.webview.saveHttpAuthCredentials.password.put", webviewCredentialSlot("password"), arg(3), "strong"),
            ],
            description: "saveHttpAuthCredentials(host, realm, username, password) stores WebView HTTP credentials.",
        },
        {
            methodId: "WebviewController.getHttpAuthCredentials",
            ownerName: "WebviewController",
            methodName: "getHttpAuthCredentials",
            modulePath: "@ohos.web.webview",
            argCount: 2,
            effects: [
                get("template.harmony.webview.getHttpAuthCredentials.username.get", webviewCredentialSlot("username"), ret()),
                get("template.harmony.webview.getHttpAuthCredentials.password.get", webviewCredentialSlot("password"), ret()),
            ],
            description: "getHttpAuthCredentials(host, realm) loads WebView HTTP credentials.",
        },
        {
            methodId: "WebviewController.deleteHttpAuthCredentials",
            ownerName: "WebviewController",
            methodName: "deleteHttpAuthCredentials",
            modulePath: "@ohos.web.webview",
            argCount: 2,
            effects: [
                kill("template.harmony.webview.deleteHttpAuthCredentials.username.kill", webviewCredentialSlot("username")),
                kill("template.harmony.webview.deleteHttpAuthCredentials.password.kill", webviewCredentialSlot("password")),
            ],
            description: "deleteHttpAuthCredentials(host, realm) invalidates WebView HTTP credentials.",
        },
    ],
});

const notificationFormAsset = makeOfficialHandoffAsset({
    id: "harmony.notification_form",
    description: "Official Harmony notification and form payload state semantics.",
    semanticsFamily: "harmony-notification-form-state",
    methods: [
        {
            methodId: "notificationManager.publish.request",
            ownerName: "notificationManager",
            methodName: "publish",
            invokeKind: "namespace",
            modulePath: "@ohos.notificationManager",
            argCount: 1,
            effects: [put("template.harmony.notification.publish.request.put", notificationSlot([unknownKey()]), arg(0), "infer")],
            description: "notificationManager.publish(request) publishes notification payload.",
        },
        {
            methodId: "notificationManager.publish.idRequest",
            ownerName: "notificationManager",
            methodName: "publish",
            invokeKind: "namespace",
            modulePath: "@ohos.notificationManager",
            argCount: 2,
            effects: [put("template.harmony.notification.publish.idRequest.put", notificationSlot([endpointKey(arg(0))]), arg(1), "infer")],
            description: "notificationManager.publish(id, request) publishes notification payload keyed by id.",
        },
        {
            methodId: "notificationManager.cancel",
            ownerName: "notificationManager",
            methodName: "cancel",
            invokeKind: "namespace",
            modulePath: "@ohos.notificationManager",
            argCount: 1,
            effects: [kill("template.harmony.notification.cancel.kill", notificationSlot([endpointKey(arg(0))]), "infer")],
            description: "notificationManager.cancel(id) invalidates notification payload keyed by id.",
        },
        {
            methodId: "formProvider.updateForm",
            ownerName: "formProvider",
            methodName: "updateForm",
            invokeKind: "namespace",
            modulePath: "@ohos.app.form.formProvider",
            argCount: 2,
            effects: [put("template.harmony.formProvider.updateForm.put", notificationSlot([endpointKey(arg(0))]), arg(1), "infer")],
            description: "formProvider.updateForm(formId, data) stores form payload keyed by formId.",
        },
        {
            methodId: "formProvider.requestPublishForm",
            ownerName: "formProvider",
            methodName: "requestPublishForm",
            invokeKind: "namespace",
            modulePath: "@ohos.app.form.formProvider",
            argCount: 2,
            effects: [put("template.harmony.formProvider.requestPublishForm.put", notificationSlot([endpointKey(arg(0))]), arg(1), "infer")],
            description: "formProvider.requestPublishForm(want, data) publishes form payload.",
        },
    ],
});

const mediaDisplayAsset = makeOfficialHandoffAsset({
    id: "harmony.media_display",
    description: "Official Harmony media player resource state semantics.",
    semanticsFamily: "harmony-media-display-state",
    methods: [
        {
            methodId: "AVPlayer.setDataSource",
            ownerName: "AVPlayer",
            methodName: "setDataSource",
            modulePath: "@ohos.multimedia.media",
            argCount: 1,
            effects: [put("template.harmony.media.AVPlayer.setDataSource.put", mediaSlot(), arg(0), "strong")],
            description: "AVPlayer.setDataSource(source) stores media source on the player handle.",
        },
        {
            methodId: "AVPlayer.setMediaSource",
            ownerName: "AVPlayer",
            methodName: "setMediaSource",
            modulePath: "@ohos.multimedia.media",
            argCount: 1,
            effects: [put("template.harmony.media.AVPlayer.setMediaSource.put", mediaSlot(), arg(0), "strong")],
            description: "AVPlayer.setMediaSource(source) stores media source on the player handle.",
        },
        {
            methodId: "AVPlayer.getDataSource",
            ownerName: "AVPlayer",
            methodName: "getDataSource",
            modulePath: "@ohos.multimedia.media",
            argCount: 0,
            effects: [get("template.harmony.media.AVPlayer.getDataSource.get", mediaSlot(), ret())],
            description: "AVPlayer.getDataSource() loads media source from the player handle.",
        },
    ],
});

const commonEventAsset = makeOfficialHandoffAsset({
    id: "harmony.common_event",
    description: "Official Harmony CommonEvent payload handoff semantics.",
    semanticsFamily: "harmony-common-event-state",
    methods: [
        {
            methodId: "commonEventManager.publish",
            ownerName: "commonEventManager",
            methodName: "publish",
            invokeKind: "namespace",
            modulePath: "@ohos.commonEventManager",
            argCount: 2,
            effects: [put("template.harmony.commonEvent.publish.put", commonEventSlot(), arg(1), "infer")],
            description: "commonEventManager.publish(event, data) sends data through the event channel.",
        },
        {
            methodId: "commonEventManager.publishAsUser",
            ownerName: "commonEventManager",
            methodName: "publishAsUser",
            invokeKind: "namespace",
            modulePath: "@ohos.commonEventManager",
            argCount: 3,
            effects: [put("template.harmony.commonEvent.publishAsUser.put", commonEventSlot(), arg(2), "infer")],
            description: "commonEventManager.publishAsUser(event, userId, data) sends data through the event channel.",
        },
        {
            methodId: "commonEventManager.subscribe",
            ownerName: "commonEventManager",
            methodName: "subscribe",
            invokeKind: "namespace",
            modulePath: "@ohos.commonEventManager",
            argCount: 2,
            effects: [get("template.harmony.commonEvent.subscribe.get", commonEventSlot(), callbackArg(1, 0))],
            description: "commonEventManager.subscribe(info, callback) receives data from the event channel.",
        },
    ],
});

const securityAsset = makeOfficialHandoffAsset({
    id: "harmony.security_asset_state",
    description: "Official Harmony security.asset keyed credential state semantics.",
    semanticsFamily: "harmony-security-asset-state",
    methods: [
        {
            methodId: "asset.add",
            ownerName: "asset",
            methodName: "add",
            invokeKind: "namespace",
            modulePath: "@ohos.security.asset",
            argCount: 1,
            effects: [put("template.harmony.security_asset.add.put", securityAssetSlot([endpointPathKey(arg(0), ["alias"])]), arg(0), "strong")],
            description: "asset.add(attributes) stores security asset attributes keyed by alias.",
        },
        {
            methodId: "asset.update",
            ownerName: "asset",
            methodName: "update",
            invokeKind: "namespace",
            modulePath: "@ohos.security.asset",
            argCount: 2,
            effects: [put("template.harmony.security_asset.update.put", securityAssetSlot([endpointPathKey(arg(0), ["alias"])]), arg(1), "strong")],
            description: "asset.update(query, attributes) updates security asset attributes keyed by alias.",
        },
        {
            methodId: "asset.query",
            ownerName: "asset",
            methodName: "query",
            invokeKind: "namespace",
            modulePath: "@ohos.security.asset",
            argCount: 1,
            effects: [get("template.harmony.security_asset.query.get", securityAssetSlot([endpointPathKey(arg(0), ["alias"])]), promiseResult())],
            description: "asset.query(query) returns security asset attributes keyed by alias.",
        },
        {
            methodId: "asset.remove",
            ownerName: "asset",
            methodName: "remove",
            invokeKind: "namespace",
            modulePath: "@ohos.security.asset",
            argCount: 1,
            effects: [kill("template.harmony.security_asset.remove.kill", securityAssetSlot([endpointPathKey(arg(0), ["alias"])]))],
            description: "asset.remove(query) invalidates security asset attributes keyed by alias.",
        },
    ],
});

const wantParameterAsset = makeOfficialHandoffAsset({
    id: "harmony.want_parameters",
    description: "Official Harmony Want parameter state semantics.",
    semanticsFamily: "harmony-want-parameter-state",
    methods: [
        {
            methodId: "Want.setParam",
            ownerName: "Want",
            methodName: "setParam",
            modulePath: "@ohos.app.ability.Want",
            argCount: 2,
            effects: [put("template.harmony.want.setParam.put", wantParamSlot([endpointKey(arg(0))]), arg(1), "infer")],
            description: "Want.setParam(key, value) stores value into the Want parameter slot.",
        },
        {
            methodId: "Want.getParam",
            ownerName: "Want",
            methodName: "getParam",
            modulePath: "@ohos.app.ability.Want",
            argCount: 1,
            effects: [get("template.harmony.want.getParam.get", wantParamSlot([endpointKey(arg(0))]), ret())],
            description: "Want.getParam(key) reads value from the Want parameter slot.",
        },
        {
            methodId: "Want.setParams",
            ownerName: "Want",
            methodName: "setParams",
            modulePath: "@ohos.app.ability.Want",
            argCount: 1,
            effects: [put("template.harmony.want.setParams.put", wantParamSlot([unknownKey()]), arg(0), "infer")],
            description: "Want.setParams(params) stores a parameter object into the Want parameter slot.",
        },
        {
            methodId: "Want.getParams",
            ownerName: "Want",
            methodName: "getParams",
            modulePath: "@ohos.app.ability.Want",
            argCount: 0,
            effects: [get("template.harmony.want.getParams.get", wantParamSlot([unknownKey()]), ret())],
            description: "Want.getParams() reads the parameter object from the Want parameter slot.",
        },
        {
            methodId: "Want.removeParam",
            ownerName: "Want",
            methodName: "removeParam",
            modulePath: "@ohos.app.ability.Want",
            argCount: 1,
            effects: [kill("template.harmony.want.removeParam.kill", wantParamSlot([endpointKey(arg(0))]), "infer")],
            description: "Want.removeParam(key) invalidates a Want parameter slot.",
        },
    ],
});

const messageParcelAsset = makeOfficialHandoffAsset({
    id: "harmony.message_parcel",
    description: "Official Harmony MessageParcel write/read payload semantics.",
    semanticsFamily: "harmony-message-parcel-state",
    methods: [
        {
            methodId: "MessageParcel.writeString",
            ownerName: "MessageParcel",
            methodName: "writeString",
            modulePath: "@ohos.rpc",
            argCount: 1,
            effects: [put("template.harmony.messageParcel.writeString.put", messageParcelSlot(), arg(0), "infer")],
            description: "MessageParcel.writeString(value) writes value into the parcel payload.",
        },
        {
            methodId: "MessageParcel.writeInt",
            ownerName: "MessageParcel",
            methodName: "writeInt",
            modulePath: "@ohos.rpc",
            argCount: 1,
            effects: [put("template.harmony.messageParcel.writeInt.put", messageParcelSlot(), arg(0), "infer")],
            description: "MessageParcel.writeInt(value) writes value into the parcel payload.",
        },
        {
            methodId: "MessageParcel.writeLong",
            ownerName: "MessageParcel",
            methodName: "writeLong",
            modulePath: "@ohos.rpc",
            argCount: 1,
            effects: [put("template.harmony.messageParcel.writeLong.put", messageParcelSlot(), arg(0), "infer")],
            description: "MessageParcel.writeLong(value) writes value into the parcel payload.",
        },
        {
            methodId: "MessageParcel.writeDouble",
            ownerName: "MessageParcel",
            methodName: "writeDouble",
            modulePath: "@ohos.rpc",
            argCount: 1,
            effects: [put("template.harmony.messageParcel.writeDouble.put", messageParcelSlot(), arg(0), "infer")],
            description: "MessageParcel.writeDouble(value) writes value into the parcel payload.",
        },
        {
            methodId: "MessageParcel.writeBoolean",
            ownerName: "MessageParcel",
            methodName: "writeBoolean",
            modulePath: "@ohos.rpc",
            argCount: 1,
            effects: [put("template.harmony.messageParcel.writeBoolean.put", messageParcelSlot(), arg(0), "infer")],
            description: "MessageParcel.writeBoolean(value) writes value into the parcel payload.",
        },
        {
            methodId: "MessageParcel.writeParcelable",
            ownerName: "MessageParcel",
            methodName: "writeParcelable",
            modulePath: "@ohos.rpc",
            argCount: 1,
            effects: [put("template.harmony.messageParcel.writeParcelable.put", messageParcelSlot(), arg(0), "infer")],
            description: "MessageParcel.writeParcelable(value) writes value into the parcel payload.",
        },
        {
            methodId: "MessageParcel.readString",
            ownerName: "MessageParcel",
            methodName: "readString",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [get("template.harmony.messageParcel.readString.get", messageParcelSlot(), ret())],
            description: "MessageParcel.readString() reads a string from the parcel payload.",
        },
        {
            methodId: "MessageParcel.readInt",
            ownerName: "MessageParcel",
            methodName: "readInt",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [get("template.harmony.messageParcel.readInt.get", messageParcelSlot(), ret())],
            description: "MessageParcel.readInt() reads an integer from the parcel payload.",
        },
        {
            methodId: "MessageParcel.readLong",
            ownerName: "MessageParcel",
            methodName: "readLong",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [get("template.harmony.messageParcel.readLong.get", messageParcelSlot(), ret())],
            description: "MessageParcel.readLong() reads a long from the parcel payload.",
        },
        {
            methodId: "MessageParcel.readDouble",
            ownerName: "MessageParcel",
            methodName: "readDouble",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [get("template.harmony.messageParcel.readDouble.get", messageParcelSlot(), ret())],
            description: "MessageParcel.readDouble() reads a double from the parcel payload.",
        },
        {
            methodId: "MessageParcel.readBoolean",
            ownerName: "MessageParcel",
            methodName: "readBoolean",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [get("template.harmony.messageParcel.readBoolean.get", messageParcelSlot(), ret())],
            description: "MessageParcel.readBoolean() reads a boolean from the parcel payload.",
        },
        {
            methodId: "MessageParcel.readParcelable",
            ownerName: "MessageParcel",
            methodName: "readParcelable",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [get("template.harmony.messageParcel.readParcelable.get", messageParcelSlot(), ret())],
            description: "MessageParcel.readParcelable() reads an object from the parcel payload.",
        },
        {
            methodId: "MessageParcel.reclaim",
            ownerName: "MessageParcel",
            methodName: "reclaim",
            modulePath: "@ohos.rpc",
            argCount: 0,
            effects: [kill("template.harmony.messageParcel.reclaim.kill", messageParcelSlot())],
            description: "MessageParcel.reclaim() invalidates the parcel payload slot.",
        },
    ],
});

export const modules: AssetDocumentBase[] = [
    fileUriAsset,
    rdbDataShareAsset,
    clipboardAsset,
    webviewBridgeAsset,
    notificationFormAsset,
    mediaDisplayAsset,
    commonEventAsset,
    securityAsset,
    wantParameterAsset,
    messageParcelAsset,
];
