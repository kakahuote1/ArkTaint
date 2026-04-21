import { RuleTier, SinkRule } from "./RuleSchema";

interface FrameworkSinkSchemaContract {
    id: string;
    tier?: RuleTier;
}

export interface FrameworkSinkFamilyContract {
    family: string;
    description: string;
    tags: string[];
    schemas: FrameworkSinkSchemaContract[];
}

const SINK_TAGS = ["harmony", "framework_sink"];

export const FRAMEWORK_SINK_FAMILY_CONTRACTS: readonly FrameworkSinkFamilyContract[] = [
    {
        family: "sink.harmony.rdb",
        description: "RDB store operations persist or dispatch sensitive data through database APIs.",
        tags: [...SINK_TAGS, "database"],
        schemas: [
            { id: "sink.harmony.rdb.executeSql.arg0" },
            { id: "sink.harmony.rdb.querySql.arg0" },
            { id: "sink.harmony.rdb.update.arg1" },
            { id: "sink.harmony.rdb.update.arg2" },
            { id: "sink.harmony.rdb.execDML.arg0" },
            { id: "sink.harmony.rdb.execDQL.arg0" },
            { id: "sink.harmony.rdb.insertSync.arg1" },
            { id: "sink.harmony.rdb.execute" },
            { id: "sink.harmony.rdb.insert" },
            { id: "sink.harmony.rdb.batchInsert" },
            { id: "sink.harmony.rdb.transaction.insert" },
            { id: "sink.harmony.rdb.transaction.update" },
            { id: "sink.harmony.rdb.transaction.execute" },
        ],
    },
    {
        family: "sink.harmony.preferences",
        description: "Preferences APIs write tainted values into persisted storage.",
        tags: [...SINK_TAGS, "preferences"],
        schemas: [
            { id: "sink.harmony.preferences.putSync.arg1" },
            { id: "sink.harmony.preferences.put.arg1" },
        ],
    },
    {
        family: "sink.harmony.globalcontext",
        description: "GlobalContext writes propagate tainted values into framework-managed object state.",
        tags: [...SINK_TAGS, "global_context"],
        schemas: [
            { id: "sink.harmony.globalcontext.setObject.arg1" },
        ],
    },
    {
        family: "sink.harmony.distributedkv",
        description: "DistributedKV writes persist tainted values into distributed key-value storage.",
        tags: [...SINK_TAGS, "distributed_kv"],
        schemas: [
            { id: "sink.harmony.distributedkv.put.arg1" },
        ],
    },
    {
        family: "sink.harmony.datashare",
        description: "DataShare APIs publish or persist tainted data across app boundaries.",
        tags: [...SINK_TAGS, "datashare"],
        schemas: [
            { id: "sink.harmony.dataShare.insert" },
            { id: "sink.harmony.dataShare.update" },
            { id: "sink.harmony.dataShare.batchInsert" },
            { id: "sink.harmony.dataShare.publish" },
        ],
    },
    {
        family: "sink.harmony.pasteboard",
        description: "Pasteboard APIs expose tainted values through clipboard state.",
        tags: [...SINK_TAGS, "pasteboard"],
        schemas: [
            { id: "sink.harmony.pasteboard.setData" },
            { id: "sink.harmony.pasteboard.setPasteData" },
        ],
    },
    {
        family: "sink.harmony.file",
        description: "File APIs persist or move tainted data through the file system.",
        tags: [...SINK_TAGS, "file_system"],
        schemas: [
            { id: "sink.harmony.fs.write.arg1" },
            { id: "sink.harmony.fs.open.arg0" },
            { id: "sink.harmony.fs.rename.arg0" },
            { id: "sink.harmony.fs.rename.arg1" },
            { id: "sink.harmony.fs.unlink.arg0" },
            { id: "sink.harmony.fs.writeSync" },
            { id: "sink.harmony.fs.copyFile" },
            { id: "sink.harmony.fs.moveFile" },
        ],
    },
    {
        family: "sink.harmony.logging.hilog_info",
        description: "HiLog info-level logging leaks tainted data through application logs.",
        tags: [...SINK_TAGS, "logging", "hilog"],
        schemas: [
            { id: "sink.harmony.hilog.info.arg3.exact", tier: "A" },
            { id: "sink.harmony.hilog.info.arg3", tier: "B" },
            { id: "sink.harmony.hilog.info.arg3.sig", tier: "C" },
        ],
    },
    {
        family: "sink.harmony.logging.hilog_error",
        description: "HiLog error-level logging leaks tainted data through application logs.",
        tags: [...SINK_TAGS, "logging", "hilog"],
        schemas: [
            { id: "sink.harmony.hilog.error.arg3.exact", tier: "A" },
            { id: "sink.harmony.hilog.error.arg3", tier: "B" },
            { id: "sink.harmony.hilog.error.arg3.sig", tier: "C" },
        ],
    },
    {
        family: "sink.harmony.logging.console",
        description: "Console logging leaks tainted values through debug output.",
        tags: [...SINK_TAGS, "logging", "console"],
        schemas: [
            { id: "sink.harmony.console.log.arg0" },
        ],
    },
    {
        family: "sink.harmony.logging.hilog_misc",
        description: "Additional HiLog levels still expose tainted values through logs.",
        tags: [...SINK_TAGS, "logging", "hilog"],
        schemas: [
            { id: "sink.harmony.hilog.debug" },
            { id: "sink.harmony.hilog.warn" },
        ],
    },
    {
        family: "sink.harmony.logging.app_event",
        description: "Application event logging writes tainted payloads into audit streams.",
        tags: [...SINK_TAGS, "logging", "app_event"],
        schemas: [
            { id: "sink.harmony.hiAppEvent.write" },
        ],
    },
    {
        family: "sink.harmony.network.http",
        description: "HTTP request APIs send tainted URLs or bodies to remote endpoints.",
        tags: [...SINK_TAGS, "network", "http"],
        schemas: [
            { id: "sink.harmony.http.request.url.arg0" },
            { id: "sink.harmony.http.request.body.arg1" },
        ],
    },
    {
        family: "sink.harmony.network.axios",
        description: "Axios APIs dispatch tainted URLs or bodies over HTTP.",
        tags: [...SINK_TAGS, "network", "axios"],
        schemas: [
            { id: "sink.harmony.axios.get.url.arg0" },
            { id: "sink.harmony.axios.post.url.arg0" },
            { id: "sink.harmony.axios.post.body.arg1" },
        ],
    },
    {
        family: "sink.harmony.network.socket",
        description: "Socket APIs expose tainted connection targets or payloads to the network.",
        tags: [...SINK_TAGS, "network", "socket"],
        schemas: [
            { id: "sink.harmony.socket.connect.arg0" },
            { id: "sink.harmony.socket.send.arg0" },
        ],
    },
    {
        family: "sink.harmony.network.request",
        description: "Request-task APIs dispatch tainted values through network transfer jobs.",
        tags: [...SINK_TAGS, "network", "request_task"],
        schemas: [
            { id: "sink.harmony.request.download.arg0" },
            { id: "sink.harmony.request.upload.arg1" },
        ],
    },
    {
        family: "sink.harmony.sms",
        description: "SMS APIs exfiltrate tainted payloads through text messages.",
        tags: [...SINK_TAGS, "sms"],
        schemas: [
            { id: "sink.harmony.sms.sendMessage" },
            { id: "sink.harmony.sms.sendMessage.v2" },
        ],
    },
    {
        family: "sink.harmony.rpc",
        description: "RPC APIs send tainted payloads across process or device boundaries.",
        tags: [...SINK_TAGS, "rpc"],
        schemas: [
            { id: "sink.harmony.rpc.sendMessageRequest" },
        ],
    },
    {
        family: "sink.harmony.bluetooth.spp",
        description: "Bluetooth SPP APIs write tainted payloads to paired devices.",
        tags: [...SINK_TAGS, "bluetooth", "spp"],
        schemas: [
            { id: "sink.harmony.bt.sppWrite" },
            { id: "sink.harmony.bt.sppWriteAsync" },
        ],
    },
    {
        family: "sink.harmony.bluetooth.ble",
        description: "BLE APIs push tainted payloads to Bluetooth characteristics or descriptors.",
        tags: [...SINK_TAGS, "bluetooth", "ble"],
        schemas: [
            { id: "sink.harmony.ble.writeCharacteristic" },
            { id: "sink.harmony.ble.writeDescriptor" },
            { id: "sink.harmony.ble.notifyCharacteristic" },
        ],
    },
    {
        family: "sink.harmony.telephony",
        description: "Telephony APIs dispatch tainted phone numbers or call metadata.",
        tags: [...SINK_TAGS, "telephony"],
        schemas: [
            { id: "sink.harmony.telephony.dial" },
            { id: "sink.harmony.telephony.dialCall" },
            { id: "sink.harmony.telephony.makeCall" },
        ],
    },
    {
        family: "sink.harmony.web",
        description: "Web component APIs load tainted content or URLs into embedded web runtimes.",
        tags: [...SINK_TAGS, "webview"],
        schemas: [
            { id: "sink.harmony.web.create.arg0" },
            { id: "sink.harmony.webcontroller.loadUrl.arg0" },
            { id: "sink.harmony.webview.loadData" },
            { id: "sink.harmony.webview.registerJavaScriptProxy" },
        ],
    },
    {
        family: "sink.harmony.javascript",
        description: "Dynamic JavaScript execution APIs evaluate tainted code strings.",
        tags: [...SINK_TAGS, "javascript"],
        schemas: [
            { id: "sink.harmony.webcontroller.runJavaScript.arg0" },
            { id: "sink.harmony.js.eval.arg0" },
            { id: "sink.harmony.js.function_ctor.arg0" },
        ],
    },
    {
        family: "sink.harmony.router.pushUrl",
        description: "Router pushUrl dispatches tainted route data into navigation flow.",
        tags: [...SINK_TAGS, "router"],
        schemas: [
            { id: "sink.harmony.router.pushUrl.arg0.exact", tier: "A" },
            { id: "sink.harmony.router.pushUrl.arg0", tier: "B" },
            { id: "sink.harmony.router.pushUrl.arg0.sig", tier: "C" },
        ],
    },
    {
        family: "sink.harmony.ability",
        description: "Ability APIs dispatch tainted intents or Want payloads.",
        tags: [...SINK_TAGS, "ability"],
        schemas: [
            { id: "sink.harmony.ability.startAbility.arg0" },
            { id: "sink.harmony.ability.startAbilityForResult.arg0" },
            { id: "sink.harmony.ability.startServiceExtension" },
            { id: "sink.harmony.wantAgent.trigger" },
        ],
    },
    {
        family: "sink.harmony.commonevent",
        description: "Common event APIs publish tainted payloads across event channels.",
        tags: [...SINK_TAGS, "common_event"],
        schemas: [
            { id: "sink.harmony.commonevent.publish.arg1" },
        ],
    },
    {
        family: "sink.harmony.notification",
        description: "Notification APIs expose tainted payloads through system notifications.",
        tags: [...SINK_TAGS, "notification"],
        schemas: [
            { id: "sink.harmony.notification.publish" },
        ],
    },
    {
        family: "sink.harmony.navigation",
        description: "Navigation stack APIs route tainted values into page transitions.",
        tags: [...SINK_TAGS, "navigation"],
        schemas: [
            { id: "sink.harmony.navPathStack.pushPath" },
            { id: "sink.harmony.navPathStack.pushPathByName" },
            { id: "sink.harmony.navPathStack.replacePath" },
        ],
    },
    {
        family: "sink.harmony.router.replaceUrl",
        description: "Router replaceUrl dispatches tainted route data into navigation flow.",
        tags: [...SINK_TAGS, "router"],
        schemas: [
            { id: "sink.harmony.router.replaceUrl" },
        ],
    },
    {
        family: "sink.harmony.contact",
        description: "Contact APIs persist tainted values into address-book state.",
        tags: [...SINK_TAGS, "contact"],
        schemas: [
            { id: "sink.harmony.contact.addContact" },
            { id: "sink.harmony.contact.updateContact" },
        ],
    },
    {
        family: "sink.harmony.calendar",
        description: "Calendar APIs persist tainted values into schedule state.",
        tags: [...SINK_TAGS, "calendar"],
        schemas: [
            { id: "sink.harmony.calendar.addEvent" },
            { id: "sink.harmony.calendar.addEvents" },
        ],
    },
    {
        family: "sink.harmony.print",
        description: "Print APIs send tainted content to external print channels.",
        tags: [...SINK_TAGS, "print"],
        schemas: [
            { id: "sink.harmony.print.print" },
        ],
    },
];

const FRAMEWORK_SINK_SCHEMA_BY_ID = new Map<string, { family: string; tags: string[]; tier: RuleTier }>();
for (const contract of FRAMEWORK_SINK_FAMILY_CONTRACTS) {
    for (const schema of contract.schemas) {
        FRAMEWORK_SINK_SCHEMA_BY_ID.set(schema.id, {
            family: contract.family,
            tags: contract.tags,
            tier: schema.tier || "B",
        });
    }
}

function mergeTags(base: string[] | undefined, extra: string[]): string[] | undefined {
    const merged = [...new Set([...(base || []), ...extra])];
    return merged.length > 0 ? merged : undefined;
}

export function isFrameworkSinkCatalogRule(rule: Pick<SinkRule, "id">): boolean {
    return FRAMEWORK_SINK_SCHEMA_BY_ID.has(rule.id);
}

export function buildFrameworkSinkRules(rawRules: SinkRule[]): SinkRule[] {
    const byId = new Map<string, SinkRule>((rawRules || []).map(rule => [rule.id, rule]));
    const out: SinkRule[] = [];
    for (const contract of FRAMEWORK_SINK_FAMILY_CONTRACTS) {
        for (const schema of contract.schemas) {
            const raw = byId.get(schema.id);
            if (!raw) continue;
            out.push({
                ...raw,
                family: contract.family,
                tier: schema.tier || "B",
                tags: mergeTags(raw.tags, contract.tags),
            });
        }
    }
    return out;
}
