import {
    RuleEndpointOrRef,
    RuleMatch,
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
    callbackArgIndexes: number[];
    schemas: FrameworkCallbackSourceSchema[];
}

const CALLBACK_SOURCE_TAGS = ["harmony", "framework_callback_source", "callback_param"];

export const FRAMEWORK_CALLBACK_SOURCE_FAMILY_CONTRACTS: readonly FrameworkCallbackSourceFamilyContract[] = [
    {
        family: "source.harmony.callback.input",
        tier: "B",
        description: "Framework text-input callbacks carry untrusted user input.",
        tags: [...CALLBACK_SOURCE_TAGS, "ui_input"],
        match: { kind: "signature_regex", value: "(TextInput|UIInput).*(onChange|onInput|onSubmit)" },
        callbackArgIndexes: [0],
        schemas: [
            {
                id: "source.harmony.input.onChange.arg0",
                target: { endpoint: "arg0" },
                description: "Text input callback parameter for onChange.",
            },
            {
                id: "source.harmony.input.onInput.arg0",
                target: { endpoint: "arg0" },
                description: "Text input callback parameter for onInput.",
            },
            {
                id: "source.harmony.input.onSubmit.arg0",
                target: { endpoint: "arg0" },
                description: "Text input callback parameter for onSubmit.",
            },
        ],
    },
    {
        family: "source.harmony.callback.network.http_completion",
        tier: "B",
        description: "HTTP async completion callbacks surface response/error objects.",
        tags: [...CALLBACK_SOURCE_TAGS, "network_http"],
        match: { kind: "signature_regex", value: "(Http|HttpRequest).*requestAsync" },
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
        family: "source.harmony.callback.window.stage",
        tier: "B",
        description: "WindowStage loadContent callback surfaces framework err/data pair.",
        tags: [...CALLBACK_SOURCE_TAGS, "window_stage"],
        match: { kind: "signature_regex", value: "WindowStage.*loadContent" },
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
        match: { kind: "signature_regex", value: "(WebView|Worker).*onMessage" },
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
        family: "source.harmony.callback.subscription.observer",
        tier: "B",
        description: "Observer/subscription callbacks surface external event payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "observer_subscription"],
        match: {
            kind: "signature_regex",
            value: "(MediaQueryListener.*\\.on\\(|CommonEventSubscriber.*subscribe|NotificationManager.*subscribe)",
        },
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
        family: "source.harmony.callback.network.stream",
        tier: "B",
        description: "Streaming/network message callbacks surface external payloads.",
        tags: [...CALLBACK_SOURCE_TAGS, "network_stream"],
        match: {
            kind: "signature_regex",
            value: "(WebSocket.*onMessage|(TCP|UDP|TLS|Local)Socket.*\\.on\\(|HttpRequest.*onDataReceive)",
        },
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
        match: { kind: "signature_regex", value: "(BLECharacteristicChange|sppRead)" },
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
        match: { kind: "signature_regex", value: "(sensor.*\\.on\\(|Geolocation.*\\.on\\()" },
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
        match: { kind: "signature_regex", value: "getSimAccountInfo" },
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
        match: { kind: "signature_regex", value: "DistributedObject.*onChange" },
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
        match: { kind: "signature_regex", value: "(tagFound|onTagFound)" },
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
        match: { kind: "signature_regex", value: "(photoAvailable|onPhotoAvailable)" },
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
                sourceKind: "callback_param",
                target: schema.target,
                callbackArgIndexes: [...contract.callbackArgIndexes],
            });
        }
    }
    return out;
}

export function isFrameworkCallbackSourceRule(rule: SourceRule): boolean {
    return rule.sourceKind === "callback_param"
        && typeof rule.family === "string"
        && rule.family.startsWith("source.harmony.callback.");
}
