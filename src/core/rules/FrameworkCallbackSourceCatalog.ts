import {
    RuleEndpointOrRef,
    RuleMatch,
    RuleScopeConstraint,
    SourceRule,
    RuleTier,
} from "./RuleSchema";

interface FrameworkCallbackSourceSchema {
    id: string;
    target: RuleEndpointOrRef;
    description: string;
    enabled?: boolean;
}

interface FrameworkCallbackSourceFamilyContract {
    family: string;
    tier: RuleTier;
    description: string;
    tags: string[];
    match: RuleMatch;
    scope?: RuleScopeConstraint;
    calleeScope?: RuleScopeConstraint;
    callbackArgIndexes: number[];
    callbackResolution?: SourceRule["callbackResolution"];
    schemas: FrameworkCallbackSourceSchema[];
}

const CALLBACK_SOURCE_TAGS = ["harmony", "framework_callback_source", "callback_param"];
const BOUND_STATE_SOURCE_TAGS = ["harmony", "framework_callback_source", "ui_input", "bound_state"];
const ARKUI_BUILD_SCOPE: RuleScopeConstraint = {
    methodName: { mode: "regex", value: "^(build|.*\\$build)$" },
    methodDecorators: [{ mode: "equals", value: "Builder" }],
};

function exactClassRegexScope(...classNames: string[]): RuleScopeConstraint {
    return {
        className: {
            mode: "regex",
            value: `^(${classNames.map(escapeRegex).join("|")})$`,
        },
    };
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const FRAMEWORK_CALLBACK_SOURCE_FAMILY_CONTRACTS: readonly FrameworkCallbackSourceFamilyContract[] = [
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework text-input callbacks carry untrusted user input.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "method_name_equals", value: "onChange", typeHint: "Input" },
        scope: ARKUI_BUILD_SCOPE,
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.input.onChange.arg0",
                target: { endpoint: "arg0" },
                description: "Text input callback parameter for onChange.",
            },
        ],
    },
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework text-input callbacks carry untrusted user input.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "method_name_equals", value: "onInput", typeHint: "Input" },
        scope: ARKUI_BUILD_SCOPE,
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.input.onInput.arg0",
                target: { endpoint: "arg0" },
                description: "Text input callback parameter for onInput.",
            },
        ],
    },
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework text-input submit callbacks carry submitted text on the event object.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "method_name_equals", value: "onSubmit", typeHint: "Input" },
        scope: ARKUI_BUILD_SCOPE,
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.input.onSubmit.arg1.text",
                target: { endpoint: "arg1", path: ["text"] },
                description: "TextInput onSubmit event.text submitted value.",
            },
        ],
    },
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework text-area callbacks carry untrusted user input.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "method_name_equals", value: "onChange", typeHint: "TextArea" },
        scope: ARKUI_BUILD_SCOPE,
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.textarea.onChange.arg0",
                target: { endpoint: "arg0" },
                description: "TextArea callback parameter for onChange.",
            },
        ],
    },
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework search callbacks carry untrusted user input.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "method_name_equals", value: "onChange", typeHint: "Search" },
        scope: ARKUI_BUILD_SCOPE,
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.search.onChange.arg0",
                target: { endpoint: "arg0" },
                description: "Search callback parameter for onChange.",
            },
        ],
    },
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework search submission callbacks carry untrusted user input.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "method_name_equals", value: "onSubmit", typeHint: "Search" },
        scope: ARKUI_BUILD_SCOPE,
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.search.onSubmit.arg0",
                target: { endpoint: "arg0" },
                description: "Search callback parameter for onSubmit.",
            },
        ],
    },
    {
        family: "source.harmony.callback.network.http_completion",
        tier: "B",
        description: "HTTP async completion callbacks surface response/error objects.",
        tags: [...CALLBACK_SOURCE_TAGS, "network_http"],
        match: { kind: "method_name_equals", value: "requestAsync" },
        calleeScope: exactClassRegexScope("Http", "HttpRequest"),
        callbackArgIndexes: [1],
        schemas: [
            {
                id: "source.harmony.network.http.requestAsync.callback.arg0",
                target: { endpoint: "arg0" },
                description: "requestAsync callback first parameter as response/error source.",
            },
            {
                id: "source.harmony.network.http.requestAsync.callback.arg1",
                target: { endpoint: "arg1" },
                description: "requestAsync callback second parameter as response data source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.network.http_completion",
        tier: "B",
        description: "HTTP request completion callbacks surface response objects.",
        tags: [...CALLBACK_SOURCE_TAGS, "network_http"],
        match: { kind: "method_name_equals", value: "request", invokeKind: "instance", argCount: 3 },
        calleeScope: exactClassRegexScope("Http", "HttpRequest"),
        callbackArgIndexes: [2],
        schemas: [
            {
                id: "source.harmony.network.http.request.callback.arg1",
                target: { endpoint: "arg1" },
                description: "Http.request callback second parameter as response data source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.window.stage",
        tier: "B",
        description: "WindowStage loadContent callback surfaces framework err/data pair.",
        tags: [...CALLBACK_SOURCE_TAGS, "window_stage"],
        match: { kind: "method_name_equals", value: "loadContent" },
        calleeScope: exactClassRegexScope("WindowStage"),
        callbackArgIndexes: [1],
        schemas: [
            {
                id: "source.harmony.window.loadContent.callback.arg0",
                target: { endpoint: "arg0" },
                description: "windowStage.loadContent callback err parameter as framework source.",
            },
            {
                id: "source.harmony.window.loadContent.callback.arg1",
                target: { endpoint: "arg1" },
                description: "windowStage.loadContent callback data parameter as framework source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.system.message",
        tier: "B",
        description: "System message-style callbacks surface external payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "system_message"],
        match: { kind: "method_name_equals", value: "onMessage" },
        calleeScope: exactClassRegexScope("WebView", "Worker"),
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.webview.onMessage.callback.arg0",
                target: { endpoint: "arg0" },
                description: "WebView onMessage callback payload as untrusted source.",
            },
            {
                id: "source.harmony.worker.onMessage.callback.arg0",
                target: { endpoint: "arg0" },
                description: "Worker onMessage callback payload as untrusted source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.web.js_proxy",
        tier: "B",
        description: "Web javaScriptProxy exposes JavaScript-provided values through registered native object methods.",
        tags: [...CALLBACK_SOURCE_TAGS, "webview", "js_proxy", "web_bridge"],
        match: { kind: "method_name_equals", value: "javaScriptProxy", invokeKind: "instance", argCount: 1 },
        callbackArgIndexes: [0],
        callbackResolution: "known_option",
        schemas: [
            {
                id: "source.harmony.webview.javaScriptProxy.callback.arg0",
                target: { endpoint: "arg0" },
                description: "First parameter of Web javaScriptProxy methodList callback as JavaScript bridge source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.subscription.observer",
        tier: "B",
        description: "Observer/subscription callbacks surface external event payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "observer_subscription"],
        match: {
            kind: "method_name_equals",
            value: "on",
        },
        calleeScope: exactClassRegexScope("MediaQueryListener", "CommonEventSubscriber", "commonEventManager", "NotificationManager"),
        callbackArgIndexes: [1],
        schemas: [
            {
                id: "source.harmony.mediaquery.onChange.callback.arg0",
                target: { endpoint: "arg0" },
                description: "MediaQuery listener callback payload as untrusted source.",
            },
            {
                id: "source.harmony.commonevent.subscribe.callback.arg0",
                target: { endpoint: "arg0" },
                description: "CommonEvent subscribe callback err parameter as framework source.",
            },
            {
                id: "source.harmony.commonevent.subscribe.callback.arg1",
                target: { endpoint: "arg1" },
                description: "CommonEvent subscribe callback event payload as framework source.",
            },
            {
                id: "source.harmony.notification.subscribe.callback.arg0",
                target: { endpoint: "arg0" },
                description: "Notification subscribe callback err parameter as framework source.",
            },
            {
                id: "source.harmony.notification.subscribe.callback.arg1",
                target: { endpoint: "arg1" },
                description: "Notification subscribe callback payload parameter as framework source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.request_task.response",
        tier: "B",
        description: "Request task response callbacks surface network response metadata and payload descriptors.",
        tags: [...CALLBACK_SOURCE_TAGS, "request_task", "network_response"],
        match: {
            kind: "method_name_equals",
            value: "on",
            invokeKind: "instance",
            argCount: 2,
            typeHint: "Task",
            literalArgs: [{ index: 0, values: ["response"] }],
        },
        calleeScope: exactClassRegexScope("Task", "DownloadTask", "UploadTask", "RequestTask"),
        callbackArgIndexes: [1],
        schemas: [
            {
                id: "source.harmony.request.task.on.response.arg0",
                target: { endpoint: "arg0" },
                description: "Task.on(\"response\") callback payload as request response source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.file_picker",
        tier: "B",
        description: "File/photo/audio picker callbacks surface user-selected URI results.",
        tags: [...CALLBACK_SOURCE_TAGS, "file_picker", "file_uri"],
        match: {
            kind: "method_name_equals",
            value: "select",
            invokeKind: "instance",
        },
        calleeScope: exactClassRegexScope("PhotoViewPicker", "DocumentViewPicker", "AudioViewPicker"),
        callbackArgIndexes: [0, 1],
        schemas: [
            {
                id: "source.harmony.filePicker.select.callback.arg1",
                target: { endpoint: "arg1" },
                description: "Picker select callback result parameter as user-selected URI source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.distributedkv",
        tier: "B",
        description: "Distributed KV callbacks surface persisted key-value entries.",
        tags: [...CALLBACK_SOURCE_TAGS, "distributed_kv"],
        match: {
            kind: "method_name_equals",
            value: "getEntries",
            invokeKind: "instance",
        },
        calleeScope: exactClassRegexScope("DistributedKVStore", "distributedKVStore", "KVStore", "SingleKVStore", "DeviceKVStore"),
        callbackArgIndexes: [1, 2],
        schemas: [
            {
                id: "source.harmony.distributedkv.getEntries.callback.arg1",
                target: { endpoint: "arg1" },
                description: "Distributed KV getEntries callback entries parameter as source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.network.stream",
        tier: "B",
        description: "Streaming/network message callbacks surface external payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "network_stream"],
        match: {
            kind: "method_name_equals",
            value: "onMessage",
        },
        calleeScope: exactClassRegexScope("WebSocket", "TCPSocket", "UDPSocket", "TLSSocket", "LocalSocket", "HttpRequest"),
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.websocket.onMessage",
                target: { endpoint: "arg0" },
                description: "WebSocket message callback payload as network source.",
            },
            {
                id: "source.harmony.socket.onMessage",
                target: { endpoint: "arg0" },
                description: "Socket on(\"message\") callback payload as network source.",
            },
            {
                id: "source.harmony.http.onDataReceive",
                target: { endpoint: "arg0" },
                description: "HttpRequest onDataReceive callback payload as network source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.device.bluetooth",
        tier: "B",
        description: "Bluetooth callbacks surface external device payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "device_bluetooth"],
        match: { kind: "method_name_equals", value: "on" },
        calleeScope: exactClassRegexScope("bluetooth", "BLE", "SppClientSocket"),
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.ble.onCharacteristicChange",
                target: { endpoint: "arg0" },
                description: "BLE characteristic change callback payload as device source.",
            },
            {
                id: "source.harmony.bt.sppRead",
                target: { endpoint: "arg0" },
                description: "Bluetooth SPP read callback payload as device source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.device.sensor",
        tier: "B",
        description: "Sensor/location callbacks surface device environment data.",
        tags: [...CALLBACK_SOURCE_TAGS, "device_sensor"],
        match: { kind: "method_name_equals", value: "on" },
        calleeScope: exactClassRegexScope("sensor", "Geolocation", "geoLocationManager"),
        callbackArgIndexes: [1, 2],
        schemas: [
            {
                id: "source.harmony.sensor.on",
                target: { endpoint: "arg0" },
                description: "Sensor.on callback payload as device source.",
            },
            {
                id: "source.harmony.geolocation.on",
                target: { endpoint: "arg0" },
                description: "Geolocation.on callback payload as device source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.device.telephony",
        tier: "B",
        description: "Telephony async callbacks surface SIM/account payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "device_telephony"],
        match: { kind: "method_name_equals", value: "getSimAccountInfo" },
        callbackArgIndexes: [1],
        schemas: [
            {
                id: "source.harmony.telephony.getSimAccountInfo.callback.arg0",
                target: { endpoint: "arg0" },
                description: "getSimAccountInfo callback err parameter as telephony source.",
            },
            {
                id: "source.harmony.telephony.getSimAccountInfo.callback.arg1",
                target: { endpoint: "arg1" },
                description: "getSimAccountInfo callback account parameter as telephony source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.distributed",
        tier: "B",
        description: "Distributed object callbacks surface cross-device state payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "distributed_state"],
        match: { kind: "method_name_equals", value: "onChange" },
        calleeScope: exactClassRegexScope("DistributedObject"),
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.distributedDataObject.onChange",
                target: { endpoint: "arg0" },
                description: "DistributedObject onChange callback payload as distributed source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.device.nfc",
        tier: "B",
        description: "NFC callbacks surface detected tag payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "device_nfc"],
        match: { kind: "method_name_equals", value: "onTagFound" },
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.nfc.onTagFound",
                target: { endpoint: "arg0" },
                description: "NFC tag callback payload as device source.",
            },
        ],
    },
    {
        family: "source.harmony.callback.device.camera",
        tier: "B",
        description: "Camera callbacks surface captured media payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "device_camera"],
        match: { kind: "method_name_equals", value: "onPhotoAvailable" },
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.camera.onPhotoAvailable",
                target: { endpoint: "arg0" },
                description: "Camera photo callback payload as device source.",
            },
        ],
    },
] as const;

export function buildFrameworkCallbackSourceRules(): SourceRule[] {
    const out: SourceRule[] = [];
    for (const contract of FRAMEWORK_CALLBACK_SOURCE_FAMILY_CONTRACTS) {
        for (const schema of contract.schemas) {
            out.push({
                id: schema.id,
                enabled: schema.enabled ?? true,
                description: schema.description,
                tags: contract.tags,
                family: contract.family,
                tier: contract.tier,
                match: contract.match,
                scope: contract.scope,
                calleeScope: contract.calleeScope,
                sourceKind: "callback_param",
                target: schema.target,
                callbackArgIndexes: [...contract.callbackArgIndexes],
                callbackResolution: contract.callbackResolution,
            });
        }
    }
    return out;
}

export function buildFrameworkBoundStateSourceRules(): SourceRule[] {
    return [
        {
            id: "source.harmony.input.textinput.text_binding",
            enabled: true,
            description: "TextInput text two-way binding updates the bound component state with user input.",
            tags: [...BOUND_STATE_SOURCE_TAGS, "textinput"],
            family: "source.harmony.callback.input",
            tier: "B",
            match: {
                kind: "method_name_equals",
                value: "create",
                invokeKind: "static",
                argCount: 1,
            },
            calleeScope: exactClassRegexScope("TextInput"),
            sourceKind: "bound_state",
            target: { endpoint: "arg0", path: ["text"] },
        },
        {
            id: "source.harmony.textarea.text_binding",
            enabled: true,
            description: "TextArea text two-way binding updates the bound component state with user input.",
            tags: [...BOUND_STATE_SOURCE_TAGS, "textarea"],
            family: "source.harmony.callback.input",
            tier: "B",
            match: {
                kind: "method_name_equals",
                value: "create",
                invokeKind: "static",
                argCount: 1,
            },
            calleeScope: exactClassRegexScope("TextArea"),
            sourceKind: "bound_state",
            target: { endpoint: "arg0", path: ["text"] },
        },
    ];
}

export function isFrameworkCallbackSourceRule(rule: SourceRule): boolean {
    return (rule.sourceKind === "callback_param" || rule.sourceKind === "bound_state")
        && typeof rule.family === "string"
        && rule.family.startsWith("source.harmony.callback.");
}
