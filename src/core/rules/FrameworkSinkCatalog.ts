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
        family: "sink.harmony.ability",
        description: "Ability APIs dispatch tainted Want or service-extension payloads.",
        tags: [...SINK_TAGS, "ability"],
        schemas: [
            { id: "sink.harmony.ability.startServiceExtension" },
        ],
    },
    {
        family: "sink.harmony.appAccount",
        description: "AppAccount APIs persist account names and credential values through framework account storage.",
        tags: [...SINK_TAGS, "account", "credential_store"],
        schemas: [
            { id: "sink.harmony.appAccount.createAccount.name.arg0.for.sink.harmony.appAccount.createAccount.name.arg0.0.exact.createAccount.class.AppAccountManager" },
            { id: "sink.harmony.appAccount.setCredential.credential.arg2.for.sink.harmony.appAccount.setCredential.credential.arg2.0.exact.setCredential.class.AppAccountManager" },
            { id: "sink.harmony.appAccount.setCredential.name.arg0.for.sink.harmony.appAccount.setCredential.name.arg0.0.exact.setCredential.class.AppAccountManager" },
        ],
    },
    {
        family: "sink.harmony.crypto.verify",
        description: "Cryptographic verify APIs consume tainted verification material.",
        tags: [...SINK_TAGS, "crypto", "verify"],
        schemas: [
            { id: "sink.harmony.crypto.verify.arg0.for.sink.harmony.crypto.verify.arg0.0.exact.verify.class.Verify" },
        ],
    },
    {
        family: "sink.harmony.datashare",
        description: "DataShare APIs publish or persist tainted data across app boundaries.",
        tags: [...SINK_TAGS, "datashare"],
        schemas: [
            { id: "sink.harmony.dataShare.batchInsert" },
            { id: "sink.harmony.dataShare.insert" },
            { id: "sink.harmony.dataShare.publish" },
            { id: "sink.harmony.dataShare.update" },
        ],
    },
    {
        family: "sink.harmony.distributedkv",
        description: "Distributed KV APIs persist tainted values into distributed key-value storage.",
        tags: [...SINK_TAGS, "distributed_kv"],
        schemas: [
            { id: "sink.harmony.distributedkv.put.arg1.for.sink.harmony.distributedkv.put.arg1.0.exact.put.class.KVStore" },
            { id: "sink.harmony.distributedkv.put.arg1.for.sink.harmony.distributedkv.put.arg1.0.exact.put.class.SingleKVStore" },
            { id: "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.KVStore.argCount1" },
            { id: "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.KVStore.argCount2" },
            { id: "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.SingleKVStore.argCount1" },
            { id: "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.SingleKVStore.argCount2" },
        ],
    },
    {
        family: "sink.harmony.form",
        description: "FormBindingData and formProvider APIs move tainted values into desktop Form data boundaries.",
        tags: [...SINK_TAGS, "form", "widget", "form_binding_data"],
        schemas: [
            { id: "sink.harmony.formbindingdata.create.arg0" },
            { id: "sink.harmony.formProvider.requestPublishForm.arg1" },
            { id: "sink.harmony.formProvider.updateForm.arg1" },
        ],
    },
    {
        family: "sink.harmony.file",
        description: "File APIs persist, open, rename, remove, copy, or move tainted path and content values.",
        tags: [...SINK_TAGS, "file_system"],
        schemas: [
            { id: "sink.harmony.fs.open.arg0.for.sink.harmony.fs.open.arg0.0.exact.open.class.File" },
            { id: "sink.harmony.filePicker.AudioViewPicker.save.arg0" },
            { id: "sink.harmony.filePicker.DocumentViewPicker.save.arg0" },
            { id: "sink.harmony.filePicker.PhotoViewPicker.save.arg0" },
            { id: "sink.harmony.fs.rename.arg0.for.sink.harmony.fs.rename.arg0.0.exact.rename.class.File" },
            { id: "sink.harmony.fs.rename.arg1.for.sink.harmony.fs.rename.arg1.0.exact.rename.class.File" },
            { id: "sink.harmony.fs.unlink.arg0.for.sink.harmony.fs.unlink.arg0.0.exact.unlink.class.File" },
            { id: "sink.harmony.fs.write.arg1.for.sink.harmony.fs.write.arg1.0.exact.write.class.File" },
        ],
    },
    {
        family: "sink.harmony.ipc.messageparcel",
        description: "MessageParcel and MessageSequence write APIs place tainted values into IPC payloads.",
        tags: [...SINK_TAGS, "ipc", "message_parcel"],
        schemas: [
            { id: "sink.harmony.ipc.messageparcel.write.for.sink.harmony.ipc.messageparcel.write.0.exact.write.class.MessageParcel" },
            { id: "sink.harmony.ipc.messageparcel.write.for.sink.harmony.ipc.messageparcel.write.0.exact.write.class.MessageSequence" },
        ],
    },
    {
        family: "sink.harmony.logging.console",
        description: "Console logging exposes tainted values through debug output.",
        tags: [...SINK_TAGS, "logging", "console"],
        schemas: [
            { id: "sink.harmony.console.debug.arg0" },
            { id: "sink.harmony.console.debug.arg0.unresolved_instance" },
            { id: "sink.harmony.console.debug.arg1.unresolved_instance" },
            { id: "sink.harmony.console.error.arg0" },
            { id: "sink.harmony.console.error.arg0.unresolved_instance" },
            { id: "sink.harmony.console.error.arg1.unresolved_instance" },
            { id: "sink.harmony.console.info.arg0" },
            { id: "sink.harmony.console.info.arg0.unresolved_instance" },
            { id: "sink.harmony.console.info.arg1.unresolved_instance" },
            { id: "sink.harmony.console.log.arg0" },
            { id: "sink.harmony.console.log.arg0.unresolved_instance" },
            { id: "sink.harmony.console.log.arg1.unresolved_instance" },
            { id: "sink.harmony.console.warn.arg0" },
            { id: "sink.harmony.console.warn.arg0.unresolved_instance" },
            { id: "sink.harmony.console.warn.arg1.unresolved_instance" },
        ],
    },
    {
        family: "sink.harmony.logging.hilog_error",
        description: "HiLog error-level logging exposes tainted data through application logs.",
        tags: [...SINK_TAGS, "logging", "hilog"],
        schemas: [
            { id: "sink.harmony.hilog.error.arg2" },
            { id: "sink.harmony.hilog.error.arg3" },
            { id: "sink.harmony.hilog.error.arg3.exact", tier: "A" },
        ],
    },
    {
        family: "sink.harmony.logging.hilog_info",
        description: "HiLog info-level logging exposes tainted data through application logs.",
        tags: [...SINK_TAGS, "logging", "hilog"],
        schemas: [
            { id: "sink.harmony.hilog.info.arg2" },
            { id: "sink.harmony.hilog.info.arg3" },
            { id: "sink.harmony.hilog.info.arg3.exact", tier: "A" },
        ],
    },
    {
        family: "sink.harmony.logging.hilog_misc",
        description: "Additional HiLog levels expose tainted data through application logs.",
        tags: [...SINK_TAGS, "logging", "hilog"],
        schemas: [
            { id: "sink.harmony.hilog.debug" },
            { id: "sink.harmony.hilog.warn" },
        ],
    },
    {
        family: "sink.harmony.network.request",
        description: "Request-task APIs dispatch tainted values through network transfer jobs.",
        tags: [...SINK_TAGS, "network", "request_task"],
        schemas: [
            { id: "sink.harmony.request.download.arg0.for.sink.harmony.request.download.arg0.0.exact.download.class.DownloadTask" },
            { id: "sink.harmony.request.upload.arg1.for.sink.harmony.request.upload.arg1.0.exact.upload.class.UploadTask" },
        ],
    },
    {
        family: "sink.harmony.network.socket",
        description: "Socket APIs expose tainted connection targets or payloads to the network.",
        tags: [...SINK_TAGS, "network", "socket"],
        schemas: [
            { id: "sink.harmony.socket.connect.arg0.for.sink.harmony.socket.connect.arg0.0.exact.connect.class.TCPSocket" },
            { id: "sink.harmony.socket.connect.arg0.for.sink.harmony.socket.connect.arg0.0.exact.connect.class.UDPSocket" },
            { id: "sink.harmony.socket.send.arg0.for.sink.harmony.socket.send.arg0.0.exact.send.class.TCPSocket" },
            { id: "sink.harmony.socket.send.arg0.for.sink.harmony.socket.send.arg0.0.exact.send.class.UDPSocket" },
        ],
    },
    {
        family: "sink.harmony.pasteboard",
        description: "Pasteboard APIs expose tainted values through clipboard state.",
        tags: [...SINK_TAGS, "pasteboard"],
        schemas: [
            { id: "sink.harmony.pasteboard.setPasteData" },
        ],
    },
    {
        family: "sink.harmony.preferences",
        description: "Preferences APIs write tainted values into persisted storage.",
        tags: [...SINK_TAGS, "preferences"],
        schemas: [
            { id: "sink.harmony.preferences.put.arg1.for.sink.harmony.preferences.put.arg1.0.exact.put.class.Preferences" },
            { id: "sink.harmony.preferences.putSync.arg1.for.sink.harmony.preferences.putSync.arg1.0.exact.putSync.class.Preferences" },
        ],
    },
    {
        family: "sink.harmony.rdb",
        description: "RDB store operations persist or dispatch tainted data through database APIs.",
        tags: [...SINK_TAGS, "database"],
        schemas: [
            { id: "sink.harmony.rdb.batchInsert.for.sink.harmony.rdb.batchInsert.0.exact.batchInsert.class.RdbStore" },
            { id: "sink.harmony.rdb.execute.for.sink.harmony.rdb.execute.0.exact.execute.class.RdbStore" },
            { id: "sink.harmony.rdb.executeSql.arg0.for.sink.harmony.rdb.executeSql.arg0.0.exact.executeSql.class.RdbStore" },
            { id: "sink.harmony.rdb.insert.for.sink.harmony.rdb.insert.0.exact.insert.class.RdbStore" },
            { id: "sink.harmony.rdb.insertSync.arg1" },
            { id: "sink.harmony.rdb.querySql.arg0.for.sink.harmony.rdb.querySql.arg0.0.exact.querySql.class.RdbStore" },
            { id: "sink.harmony.rdb.transaction.execute" },
            { id: "sink.harmony.rdb.transaction.insert" },
            { id: "sink.harmony.rdb.transaction.update" },
            { id: "sink.harmony.rdb.update.arg1.for.sink.harmony.rdb.update.arg1.0.exact.update.class.RdbStore" },
            { id: "sink.harmony.rdb.update.arg2.for.sink.harmony.rdb.update.arg2.0.exact.update.class.RdbStore" },
            { id: "sink.harmony.rdb.update.values.arg0.for.sink.harmony.rdb.update.values.arg0.0.exact.update.class.RdbStore" },
        ],
    },
    {
        family: "sink.harmony.router.pushUrl",
        description: "Router pushUrl dispatches tainted route data into navigation flow.",
        tags: [...SINK_TAGS, "router"],
        schemas: [
            { id: "sink.harmony.router.pushUrl.arg0" },
            { id: "sink.harmony.router.pushUrl.arg0.exact", tier: "A" },
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
        family: "sink.harmony.ui.display",
        description: "ArkUI display APIs render tainted text, content, or resource values in UI surfaces.",
        tags: [...SINK_TAGS, "arkui", "display"],
        schemas: [
            { id: "sink.harmony.arkui.AbilityComponent.arg0" },
            { id: "sink.harmony.arkui.CanvasRenderer.drawImage.arg0" },
            { id: "sink.harmony.arkui.CanvasRenderer.fillText.arg0" },
            { id: "sink.harmony.arkui.CanvasRenderer.strokeText.arg0" },
            { id: "sink.harmony.arkui.Hyperlink.arg0" },
            { id: "sink.harmony.arkui.Image.arg0" },
            { id: "sink.harmony.arkui.ImageBitmap.constructor.arg0" },
            { id: "sink.harmony.arkui.ImageData.constructor.arg0" },
            { id: "sink.harmony.arkui.ImageSpan.arg0" },
            { id: "sink.harmony.arkui.RichText.arg0" },
            { id: "sink.harmony.arkui.Span.arg0" },
            { id: "sink.harmony.arkui.Text.arg0" },
            { id: "sink.harmony.arkui.TextArea.arg0" },
            { id: "sink.harmony.arkui.TextInput.arg0" },
            { id: "sink.harmony.arkui.TextPicker.arg0" },
            { id: "sink.harmony.arkui.Video.arg0" },
            { id: "sink.harmony.promptAction.showDialog.arg0" },
            { id: "sink.harmony.promptAction.showToast.arg0" },
        ],
    },
    {
        family: "sink.harmony.web",
        description: "Web component APIs load tainted content or URLs into embedded web runtimes.",
        tags: [...SINK_TAGS, "webview"],
        schemas: [
            { id: "sink.harmony.webcontroller.loadUrl.arg0.for.sink.harmony.webcontroller.loadUrl.arg0.0.exact.loadUrl.class.WebviewController" },
            { id: "sink.harmony.webcontroller.runJavaScript.arg0.for.sink.harmony.webcontroller.runJavaScript.arg0.0.exact.runJavaScript.class.WebviewController" },
            { id: "sink.harmony.webview.registerJavaScriptProxy" },
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
