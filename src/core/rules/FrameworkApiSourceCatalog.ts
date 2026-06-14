import {
    RuleEndpointOrRef,
    RuleMatch,
    RuleScopeConstraint,
    RuleTier,
    SourceRule,
    SourceRuleKind,
} from "./RuleSchema";

interface FrameworkApiSourceSchema {
    id: string;
    sourceKind: SourceRuleKind;
    target: RuleEndpointOrRef;
    description: string;
    match: RuleMatch;
    calleeScope?: RuleScopeConstraint;
    enabled?: boolean;
}

interface FrameworkApiSourceFamilyContract {
    family: string;
    tier: RuleTier;
    description: string;
    tags: string[];
    schemas: FrameworkApiSourceSchema[];
}

const API_SOURCE_TAGS = ["harmony", "framework_api_source"];
const RESULT_TARGET: RuleEndpointOrRef = { endpoint: "result" };

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactClassRegexScope(...classNames: string[]): RuleScopeConstraint {
    return {
        className: {
            mode: "regex",
            value: `^(${classNames.map(escapeRegex).join("|")})$`,
        },
    };
}

function moduleRegexScope(value: string): RuleScopeConstraint {
    return {
        module: {
            mode: "regex",
            value,
        },
    };
}

function classContainsScope(className: string): RuleScopeConstraint {
    return {
        className: {
            mode: "contains",
            value: className,
        },
    };
}

function methodEqualsScope(methodName: string): RuleScopeConstraint {
    return {
        methodName: {
            mode: "equals",
            value: methodName,
        },
    };
}

function mergeScopes(...scopes: Array<RuleScopeConstraint | undefined>): RuleScopeConstraint | undefined {
    const merged: RuleScopeConstraint = {};
    for (const scope of scopes) {
        if (!scope) continue;
        if (scope.file) merged.file = scope.file;
        if (scope.module) merged.module = scope.module;
        if (scope.className) merged.className = scope.className;
        if (scope.methodName) merged.methodName = scope.methodName;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function methodEquals(value: string): RuleMatch {
    return { kind: "method_name_equals", value };
}

function instanceMethodEquals(value: string): RuleMatch {
    return { kind: "method_name_equals", value, invokeKind: "instance" };
}

function signatureContains(value: string): RuleMatch {
    return { kind: "signature_contains", value };
}

function signatureRegex(value: string): RuleMatch {
    return { kind: "signature_regex", value };
}

function apiCallReturn(
    id: string,
    description: string,
    match: RuleMatch,
    calleeScope?: RuleScopeConstraint,
    _legacySurfaceHints?: unknown,
): FrameworkApiSourceSchema {
    return {
        id,
        sourceKind: "call_return",
        target: RESULT_TARGET,
        description,
        match,
        calleeScope,
    };
}

function apiFieldRead(
    id: string,
    description: string,
    match: RuleMatch,
    calleeScope?: RuleScopeConstraint,
): FrameworkApiSourceSchema {
    return {
        id,
        sourceKind: "field_read",
        target: RESULT_TARGET,
        description,
        match,
        calleeScope,
    };
}

export const FRAMEWORK_API_SOURCE_FAMILY_CONTRACTS: readonly FrameworkApiSourceFamilyContract[] = [
    {
        family: "source.harmony.network.http",
        tier: "B",
        description: "HTTP request APIs surface remote response objects.",
        tags: [...API_SOURCE_TAGS, "network_http"],
        schemas: [
            apiCallReturn(
                "source.harmony.network.http.request.result",
                "Http.request() return value as network response source.",
                instanceMethodEquals("request"),
                exactClassRegexScope("Http"),
            ),
        ],
    },
    {
        family: "source.harmony.preferences",
        tier: "B",
        description: "Preferences APIs surface persisted values.",
        tags: [...API_SOURCE_TAGS, "preferences"],
        schemas: [
            apiCallReturn(
                "source.harmony.preferences.getSync.result",
                "Preference getSync() return value as persistence source.",
                methodEquals("getSync"),
                exactClassRegexScope("Preferences", "DataPreferences"),
            ),
            apiCallReturn(
                "source.harmony.preferences.get.result",
                "Preference get() return value as persistence source.",
                instanceMethodEquals("get"),
                exactClassRegexScope("Preferences", "DataPreferences"),
                [
                    {
                        modulePath: "ohos/preferences",
                        declaringClassName: "Preferences",
                        methodName: "get",
                        invokeKind: "instance",
                        argCount: 1,
                    },
                ],
            ),
        ],
    },
    {
        family: "source.harmony.appAccount",
        tier: "B",
        description: "AppAccount APIs surface framework-managed account credentials.",
        tags: [...API_SOURCE_TAGS, "account", "credential_store"],
        schemas: [
            apiCallReturn(
                "source.harmony.appAccount.getCredential.result",
                "AppAccountManager.getCredential() return value as an account credential source.",
                { kind: "method_name_equals", value: "getCredential", invokeKind: "instance", argCount: 2 },
                exactClassRegexScope("AppAccountManager", "appAccount", "AppAccount"),
            ),
        ],
    },
    {
        family: "source.harmony.rdb",
        tier: "B",
        description: "RDB query APIs surface database-backed rows and result views.",
        tags: [...API_SOURCE_TAGS, "rdb"],
        schemas: [
            apiCallReturn(
                "source.harmony.rdb.querySql.result",
                "querySql() return value as database source.",
                methodEquals("querySql"),
                exactClassRegexScope("RdbStore", "RelationalStore"),
            ),
            apiCallReturn(
                "source.harmony.rdb.query.result",
                "query() return value as database source.",
                methodEquals("query"),
                exactClassRegexScope("RdbStore", "RelationalStore"),
            ),
            apiFieldRead(
                "source.harmony.rdb.changeInfo.table",
                "ChangeInfo.table field read as database-change metadata source.",
                { kind: "local_name_regex", value: "^table$" },
                exactClassRegexScope("ChangeInfo"),
            ),
            apiFieldRead(
                "source.harmony.rdb.changeInfo.type",
                "ChangeInfo.type field read as database-change metadata source.",
                { kind: "local_name_regex", value: "^type$" },
                exactClassRegexScope("ChangeInfo"),
            ),
            apiFieldRead(
                "source.harmony.rdb.changeInfo.inserted",
                "ChangeInfo.inserted field read as database-change metadata source.",
                { kind: "local_name_regex", value: "^inserted$" },
                exactClassRegexScope("ChangeInfo"),
            ),
            apiFieldRead(
                "source.harmony.rdb.changeInfo.updated",
                "ChangeInfo.updated field read as database-change metadata source.",
                { kind: "local_name_regex", value: "^updated$" },
                exactClassRegexScope("ChangeInfo"),
            ),
            apiFieldRead(
                "source.harmony.rdb.changeInfo.deleted",
                "ChangeInfo.deleted field read as database-change metadata source.",
                { kind: "local_name_regex", value: "^deleted$" },
                exactClassRegexScope("ChangeInfo"),
            ),
        ],
    },
    {
        family: "source.harmony.globalcontext",
        tier: "B",
        description: "GlobalContext APIs surface framework-managed object state.",
        tags: [...API_SOURCE_TAGS, "global_context"],
        schemas: [
            apiCallReturn(
                "source.harmony.globalcontext.getObject.result",
                "GlobalContext.getObject() return value as framework object source.",
                signatureContains("GlobalContext.getObject"),
            ),
        ],
    },
    {
        family: "source.harmony.webview.auth_cache",
        tier: "B",
        description: "WebView HTTP-auth credential cache reads surface stored usernames and passwords.",
        tags: [...API_SOURCE_TAGS, "webview", "credential_store"],
        schemas: [
            apiCallReturn(
                "source.harmony.webview.webdatabase.getHttpAuthCredentials.result",
                "WebDataBase.getHttpAuthCredentials() return value as WebView credential-cache source.",
                { kind: "method_name_equals", value: "getHttpAuthCredentials", invokeKind: "instance", argCount: 2 },
                exactClassRegexScope("WebDataBase", "WebDatabase", "WebviewDataBase"),
            ),
        ],
    },
    {
        family: "source.harmony.webview.request",
        tier: "B",
        description: "WebView resource request APIs surface URL, header, and method data from embedded web runtime.",
        tags: [...API_SOURCE_TAGS, "webview", "web_resource_request"],
        schemas: [
            apiCallReturn(
                "source.harmony.webview.webResourceRequest.getRequestUrl.result",
                "WebResourceRequest.getRequestUrl() return value as WebView request URL source.",
                { kind: "method_name_equals", value: "getRequestUrl", invokeKind: "instance" },
                exactClassRegexScope("WebResourceRequest"),
            ),
            apiCallReturn(
                "source.harmony.webview.webResourceRequest.getRequestHeader.result",
                "WebResourceRequest.getRequestHeader() return value as WebView request header source.",
                { kind: "method_name_equals", value: "getRequestHeader", invokeKind: "instance" },
                exactClassRegexScope("WebResourceRequest"),
            ),
            apiCallReturn(
                "source.harmony.webview.webResourceRequest.getMethod.result",
                "WebResourceRequest.getMethod() return value as WebView request method source.",
                { kind: "method_name_equals", value: "getMethod", invokeKind: "instance" },
                exactClassRegexScope("WebResourceRequest"),
            ),
        ],
    },
    {
        family: "source.harmony.file",
        tier: "B",
        description: "File APIs surface external file-system data.",
        tags: [...API_SOURCE_TAGS, "file_system"],
        schemas: [
            apiCallReturn(
                "source.harmony.fs.read.result",
                "Binary file read() return value as file source.",
                methodEquals("read"),
                exactClassRegexScope("fs", "File", "FileIo", "FileInput", "FileAccess", "FileOperator"),
            ),
            apiCallReturn(
                "source.harmony.fs.readSync.result",
                "Binary file readSync() return value as file source.",
                methodEquals("readSync"),
                exactClassRegexScope("fs", "File", "FileIo", "FileInput", "FileAccess", "FileOperator"),
            ),
            apiCallReturn(
                "source.harmony.fs.readText",
                "Text file readText() return value as file source.",
                methodEquals("readText"),
                classContainsScope("fs"),
            ),
            apiCallReturn(
                "source.harmony.fs.readTextSync",
                "Text file readTextSync() return value as file source.",
                methodEquals("readTextSync"),
                classContainsScope("fs"),
            ),
            apiCallReturn(
                "source.harmony.file.picker.select.result",
                "File/photo/audio picker select() return value as user-selected URI source.",
                instanceMethodEquals("select"),
                exactClassRegexScope("PhotoViewPicker", "DocumentViewPicker", "AudioViewPicker"),
            ),
        ],
    },
    {
        family: "source.harmony.request",
        tier: "B",
        description: "Request task APIs surface downloaded or uploaded payloads.",
        tags: [...API_SOURCE_TAGS, "request_task"],
        schemas: [
            apiCallReturn(
                "source.harmony.request.download.result",
                "download() return value as request task source.",
                methodEquals("download"),
                exactClassRegexScope("request", "Request", "Download", "DownloadTask", "RequestAgent"),
            ),
            apiCallReturn(
                "source.harmony.request.upload.result",
                "upload() return value as request task source.",
                methodEquals("upload"),
                exactClassRegexScope("request", "Request", "Upload", "UploadTask", "RequestAgent"),
            ),
            apiCallReturn(
                "source.harmony.request.downloadFile.result",
                "downloadFile() return value as request task source.",
                { kind: "method_name_equals", value: "downloadFile", invokeKind: "static", argCount: 2 },
                exactClassRegexScope("request", "Request"),
            ),
            apiCallReturn(
                "source.harmony.request.uploadFile.result",
                "uploadFile() return value as request task source.",
                { kind: "method_name_equals", value: "uploadFile", invokeKind: "static", argCount: 2 },
                exactClassRegexScope("request", "Request"),
            ),
            apiCallReturn(
                "source.harmony.request.cacheDownload.result",
                "cacheDownload.download() return value as request task source.",
                signatureRegex("cacheDownload.*\\.download"),
            ),
        ],
    },
    {
        family: "source.harmony.distributedkv",
        tier: "B",
        description: "Distributed KV APIs surface cross-device key-value state.",
        tags: [...API_SOURCE_TAGS, "distributed_kv"],
        schemas: [
            apiCallReturn(
                "source.harmony.distributedkv.get.result",
                "DistributedKVStore.get() return value as distributed storage source.",
                instanceMethodEquals("get"),
                exactClassRegexScope("DistributedKVStore", "distributedKVStore", "KVStore", "SingleKVStore", "DeviceKVStore"),
            ),
            apiCallReturn(
                "source.harmony.distributedkv.getEntries.result",
                "Distributed KV getEntries() return value as distributed storage source.",
                instanceMethodEquals("getEntries"),
                exactClassRegexScope("DistributedKVStore", "distributedKVStore", "KVStore", "SingleKVStore", "DeviceKVStore"),
            ),
        ],
    },
    {
        family: "source.harmony.rpc",
        tier: "B",
        description: "RPC request APIs surface reply parcels and message responses.",
        tags: [...API_SOURCE_TAGS, "rpc", "ipc"],
        schemas: [
            apiCallReturn(
                "source.harmony.rpc.sendRequest.reply",
                "sendRequest() return value as RPC reply source.",
                { kind: "method_name_equals", value: "sendRequest", invokeKind: "instance" },
                exactClassRegexScope("IRemoteObject", "RemoteObject", "RemoteProxy", "rpc", "RPC"),
            ),
            apiCallReturn(
                "source.harmony.rpc.sendMessageRequest.reply",
                "sendMessageRequest() return value as RPC reply source.",
                { kind: "method_name_equals", value: "sendMessageRequest", invokeKind: "instance" },
                exactClassRegexScope("IRemoteObject", "RemoteObject", "RemoteProxy", "rpc", "RPC"),
            ),
        ],
    },
    {
        family: "source.harmony.ipc.messageparcel",
        tier: "B",
        description: "MessageParcel and MessageSequence read APIs surface IPC payload values.",
        tags: [...API_SOURCE_TAGS, "ipc", "message_parcel"],
        schemas: [
            apiCallReturn(
                "source.harmony.ipc.messageparcel.read.result",
                "MessageParcel/MessageSequence read*() return value as IPC payload source, excluding readException.",
                { kind: "method_name_regex", value: "^read(?!Exception$).+", invokeKind: "instance" },
                exactClassRegexScope("MessageParcel", "MessageSequence"),
            ),
        ],
    },
    {
        family: "source.harmony.pasteboard",
        tier: "B",
        description: "Pasteboard APIs surface clipboard state.",
        tags: [...API_SOURCE_TAGS, "pasteboard"],
        schemas: [
            apiCallReturn(
                "source.harmony.privacy.pasteboard.getSystemPasteboard.result",
                "getSystemPasteboard() return value as clipboard source.",
                methodEquals("getSystemPasteboard"),
                exactClassRegexScope("pasteboard", "Pasteboard"),
            ),
            apiCallReturn(
                "source.harmony.privacy.pasteboard.getData.result",
                "getData() return value as clipboard payload source.",
                methodEquals("getData"),
                exactClassRegexScope("pasteboard", "Pasteboard"),
            ),
        ],
    },
    {
        family: "source.harmony.contact",
        tier: "B",
        description: "Contact APIs surface address-book data.",
        tags: [...API_SOURCE_TAGS, "contact"],
        schemas: [
            apiCallReturn(
                "source.harmony.privacy.contacts.queryContacts.result",
                "queryContacts() return value as contact source.",
                methodEquals("queryContacts"),
            ),
            apiCallReturn(
                "source.harmony.contact.queryContact",
                "queryContact() return value as contact source.",
                methodEquals("queryContact"),
            ),
            apiCallReturn(
                "source.harmony.contact.selectContact",
                "selectContact() return value as contact source.",
                methodEquals("selectContact"),
            ),
            apiCallReturn(
                "source.harmony.contact.selectContacts",
                "selectContacts() return value as contact source.",
                methodEquals("selectContacts"),
            ),
        ],
    },
    {
        family: "source.harmony.device_id",
        tier: "B",
        description: "Device identity APIs surface persistent identifiers.",
        tags: [...API_SOURCE_TAGS, "device_identity"],
        schemas: [
            apiCallReturn(
                "source.harmony.telephony.getIMEI",
                "getIMEI() return value as device identifier source.",
                signatureContains("getIMEI"),
            ),
            apiCallReturn(
                "source.harmony.oaid.getOAID",
                "getOAID() return value as device identifier source.",
                signatureContains("getOAID"),
            ),
            apiFieldRead(
                "source.harmony.deviceInfo.udid",
                "deviceInfo.udid field read as device identifier source.",
                signatureContains("deviceInfo"),
                exactClassRegexScope("deviceInfo"),
            ),
        ],
    },
    {
        family: "source.harmony.location",
        tier: "B",
        description: "Location APIs surface environment position data.",
        tags: [...API_SOURCE_TAGS, "location"],
        schemas: [
            apiCallReturn(
                "source.harmony.geo.getCurrentLocation",
                "getCurrentLocation() return value as location source.",
                signatureContains("getCurrentLocation"),
                classContainsScope("geoLocation"),
            ),
            apiCallReturn(
                "source.harmony.geo.getLastLocation",
                "getLastLocation() return value as location source.",
                signatureContains("getLastLocation"),
                classContainsScope("geoLocation"),
            ),
        ],
    },
    {
        family: "source.harmony.telephony",
        tier: "B",
        description: "Telephony APIs surface SIM and network state.",
        tags: [...API_SOURCE_TAGS, "telephony"],
        schemas: [
            apiCallReturn(
                "source.harmony.sim.getSimAccountInfo",
                "getSimAccountInfo() return value as telephony source.",
                signatureContains("getSimAccountInfo"),
            ),
            apiCallReturn(
                "source.harmony.sim.getVoiceMailNumber",
                "getVoiceMailNumber() return value as telephony source.",
                signatureContains("getVoiceMailNumber"),
            ),
            apiCallReturn(
                "source.harmony.sim.getSimSpn",
                "getSimSpn() return value as telephony source.",
                signatureContains("getSimSpn"),
            ),
            apiCallReturn(
                "source.harmony.telephony.getIMEISV",
                "getIMEISV() return value as telephony source.",
                signatureContains("getIMEISV"),
            ),
            apiCallReturn(
                "source.harmony.telephony.getCellInformation",
                "getCellInformation() return value as telephony source.",
                signatureContains("getCellInformation"),
            ),
            apiCallReturn(
                "source.harmony.telephony.getNetworkState",
                "getNetworkState() return value as telephony source.",
                signatureContains("getNetworkState"),
            ),
        ],
    },
    {
        family: "source.harmony.wifi",
        tier: "B",
        description: "Wi-Fi APIs surface device network metadata.",
        tags: [...API_SOURCE_TAGS, "wifi"],
        schemas: [
            apiCallReturn(
                "source.harmony.wifi.getLinkedInfo",
                "getLinkedInfo() return value as Wi-Fi source.",
                signatureContains("getLinkedInfo"),
                classContainsScope("wifi"),
            ),
            apiCallReturn(
                "source.harmony.wifi.getScanResults",
                "getScanResults() return value as Wi-Fi source.",
                methodEquals("getScanResults"),
                classContainsScope("wifi"),
            ),
            apiCallReturn(
                "source.harmony.wifi.getScanInfoList",
                "getScanInfoList() return value as Wi-Fi source.",
                signatureContains("getScanInfoList"),
            ),
            apiCallReturn(
                "source.harmony.wifi.getDeviceMacAddress",
                "getDeviceMacAddress() return value as Wi-Fi source.",
                signatureContains("getDeviceMacAddress"),
            ),
            apiCallReturn(
                "source.harmony.wifi.getIpInfo",
                "getIpInfo() return value as Wi-Fi source.",
                methodEquals("getIpInfo"),
                classContainsScope("wifi"),
            ),
            apiCallReturn(
                "source.harmony.wifi.getIpv6Info",
                "getIpv6Info() return value as Wi-Fi source.",
                signatureContains("getIpv6Info"),
            ),
        ],
    },
    {
        family: "source.harmony.calendar",
        tier: "B",
        description: "Calendar APIs surface user event data.",
        tags: [...API_SOURCE_TAGS, "calendar"],
        schemas: [
            apiCallReturn(
                "source.harmony.calendar.getEvents",
                "getEvents() return value as calendar source.",
                signatureContains("getEvents"),
                classContainsScope("Calendar"),
            ),
        ],
    },
    {
        family: "source.harmony.audio",
        tier: "B",
        description: "Audio capture APIs surface recorded media payloads.",
        tags: [...API_SOURCE_TAGS, "audio"],
        schemas: [
            apiCallReturn(
                "source.harmony.audio.capturer.read",
                "AudioCapturer.read() return value as audio source.",
                signatureContains("AudioCapturer"),
                mergeScopes(classContainsScope("AudioCapturer"), methodEqualsScope("read")),
            ),
        ],
    },
    {
        family: "source.harmony.bluetooth",
        tier: "B",
        description: "Bluetooth APIs surface connected device data.",
        tags: [...API_SOURCE_TAGS, "bluetooth"],
        schemas: [
            apiCallReturn(
                "source.harmony.ble.readCharacteristic",
                "readCharacteristicValue() return value as Bluetooth source.",
                signatureContains("readCharacteristicValue"),
            ),
            apiCallReturn(
                "source.harmony.ble.readDescriptor",
                "readDescriptorValue() return value as Bluetooth source.",
                signatureContains("readDescriptorValue"),
            ),
            apiCallReturn(
                "source.harmony.bt.getPairedDevices",
                "getPairedDevices() return value as Bluetooth source.",
                signatureContains("getPairedDevices"),
            ),
            apiCallReturn(
                "source.harmony.bt.getLocalName",
                "getLocalName() return value as Bluetooth source.",
                signatureContains("getLocalName"),
                classContainsScope("bluetooth"),
            ),
            apiCallReturn(
                "source.harmony.ble.getConnectedDevices",
                "getConnectedBLEDevices() return value as Bluetooth source.",
                signatureContains("getConnectedBLEDevices"),
            ),
        ],
    },
    {
        family: "source.harmony.media",
        tier: "B",
        description: "Media APIs surface photo and asset collections.",
        tags: [...API_SOURCE_TAGS, "media"],
        schemas: [
            apiCallReturn(
                "source.harmony.photo.getAssets",
                "getAssets() return value as media source.",
                signatureContains("getAssets"),
                classContainsScope("PhotoAccessHelper"),
            ),
        ],
    },
    {
        family: "source.harmony.datashare",
        tier: "B",
        description: "DataShare APIs surface shared provider results.",
        tags: [...API_SOURCE_TAGS, "datashare"],
        schemas: [
            apiCallReturn(
                "source.harmony.dataShare.query",
                "DataShareHelper.query() return value as shared-data source.",
                signatureContains("DataShareHelper"),
                methodEqualsScope("query"),
            ),
        ],
    },
    {
        family: "source.harmony.account",
        tier: "B",
        description: "Account APIs surface OS account identifiers.",
        tags: [...API_SOURCE_TAGS, "account"],
        schemas: [
            apiCallReturn(
                "source.harmony.account.getOsAccountName",
                "getOsAccountName() return value as account source.",
                signatureContains("getOsAccountName"),
            ),
        ],
    },
    {
        family: "source.harmony.security_asset",
        tier: "B",
        description: "Security asset query APIs surface stored security material metadata and values.",
        tags: [...API_SOURCE_TAGS, "security_asset", "credential_store"],
        schemas: [
            apiCallReturn(
                "source.harmony.securityAsset.query.result",
                "security.asset.query() return value as security asset source.",
                { kind: "method_name_equals", value: "query", invokeKind: "static" },
                exactClassRegexScope("asset", "SecurityAsset", "securityAsset"),
            ),
            apiCallReturn(
                "source.harmony.securityAsset.querySync.result",
                "security.asset.querySync() return value as security asset source.",
                { kind: "method_name_equals", value: "querySync", invokeKind: "static" },
                exactClassRegexScope("asset", "SecurityAsset", "securityAsset"),
            ),
        ],
    },
    {
        family: "source.harmony.settings",
        tier: "B",
        description: "Settings APIs surface system configuration state.",
        tags: [...API_SOURCE_TAGS, "settings"],
        schemas: [
            apiCallReturn(
                "source.harmony.settings.getValue",
                "settings.getValue() return value as settings source.",
                methodEquals("getValue"),
                classContainsScope("settings"),
            ),
            apiCallReturn(
                "source.harmony.settings.getValueSync",
                "settings.getValueSync() return value as settings source.",
                signatureContains("getValueSync"),
                classContainsScope("settings"),
            ),
        ],
    },
    {
        family: "source.harmony.system",
        tier: "B",
        description: "System parameter APIs surface device configuration.",
        tags: [...API_SOURCE_TAGS, "system"],
        schemas: [
            apiCallReturn(
                "source.harmony.systemParam.get",
                "systemParameterEnhance.get() return value as system source.",
                signatureContains("systemParameterEnhance"),
                methodEqualsScope("get"),
            ),
        ],
    },
    {
        family: "source.harmony.display",
        tier: "B",
        description: "Display APIs surface current display metadata.",
        tags: [...API_SOURCE_TAGS, "display"],
        schemas: [
            apiCallReturn(
                "source.harmony.display.getDefaultDisplay",
                "getDefaultDisplay() return value as display source.",
                signatureContains("getDefaultDisplay"),
            ),
        ],
    },
    {
        family: "source.harmony.data",
        tier: "B",
        description: "Unified data APIs surface record payloads.",
        tags: [...API_SOURCE_TAGS, "data_record"],
        schemas: [
            apiCallReturn(
                "source.harmony.unifiedData.getValue",
                "UnifiedRecord.getValue() return value as data record source.",
                signatureContains("UnifiedRecord"),
                methodEqualsScope("getValue"),
            ),
        ],
    },
    {
        family: "source.harmony.distributed",
        tier: "B",
        description: "Distributed device APIs surface nearby-device metadata.",
        tags: [...API_SOURCE_TAGS, "distributed_device"],
        schemas: [
            apiCallReturn(
                "source.harmony.distributed.getLocalDeviceId",
                "getLocalDeviceId() return value as distributed-device source.",
                methodEquals("getLocalDeviceId"),
            ),
            apiCallReturn(
                "source.harmony.distributed.getLocalDeviceName",
                "getLocalDeviceName() return value as distributed-device source.",
                methodEquals("getLocalDeviceName"),
            ),
            apiCallReturn(
                "source.harmony.distributed.getLocalDeviceNetworkId",
                "getLocalDeviceNetworkId() return value as distributed-device source.",
                signatureContains("getLocalDeviceNetworkId"),
            ),
            apiCallReturn(
                "source.harmony.distributed.getAvailableDeviceList",
                "getAvailableDeviceList() return value as distributed-device source.",
                signatureContains("getAvailableDeviceList"),
            ),
        ],
    },
    {
        family: "source.harmony.ability",
        tier: "B",
        description: "Ability utility APIs surface wrapped Want state.",
        tags: [...API_SOURCE_TAGS, "ability"],
        schemas: [
            apiCallReturn(
                "source.harmony.wantAgent.getWant",
                "wantAgent.getWant() return value as ability handoff source.",
                signatureContains("getWant"),
                classContainsScope("wantAgent"),
            ),
        ],
    },
] as const;

const FRAMEWORK_API_SOURCE_FAMILY_SET = new Set(
    FRAMEWORK_API_SOURCE_FAMILY_CONTRACTS.map(contract => contract.family)
);

export function buildFrameworkApiSourceRules(): SourceRule[] {
    const out: SourceRule[] = [];
    for (const contract of FRAMEWORK_API_SOURCE_FAMILY_CONTRACTS) {
        for (const schema of contract.schemas) {
            out.push({
                id: schema.id,
                enabled: schema.enabled ?? true,
                description: schema.description,
                tags: contract.tags,
                family: contract.family,
                tier: contract.tier,
                match: schema.match,
                sourceKind: schema.sourceKind,
                target: schema.target,
                calleeScope: schema.calleeScope,
            });
        }
    }
    return out;
}

export function isFrameworkApiSourceRule(rule: SourceRule): boolean {
    return (rule.sourceKind === "call_return" || rule.sourceKind === "field_read")
        && typeof rule.family === "string"
        && FRAMEWORK_API_SOURCE_FAMILY_SET.has(rule.family);
}
