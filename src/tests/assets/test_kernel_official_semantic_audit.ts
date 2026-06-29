import * as fs from "fs";
import * as path from "path";

type Json = Record<string, any>;

const ROOT = process.cwd();
const SOURCE_FILE = "src/models/kernel/rules/sources/official_declarations.rules.json";
const SINK_FILE = "src/models/kernel/rules/sinks/official_declarations.rules.json";
const TRANSFER_FILE = "src/models/kernel/rules/transfers/official_declarations.rules.json";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function readJson(file: string): Json {
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf8"));
}

function decodeCanonical(canonicalApiId: string): string {
    try {
        return decodeURIComponent(canonicalApiId);
    } catch {
        return canonicalApiId;
    }
}

function paramsText(canonicalApiId: string): string {
    const decoded = decodeCanonical(canonicalApiId);
    const start = decoded.indexOf(":params=");
    const end = decoded.lastIndexOf(":ret=");
    if (start < 0 || end < 0 || end < start) return "";
    return decoded.slice(start + ":params=".length, end);
}

function returnType(canonicalApiId: string): string {
    const decoded = decodeCanonical(canonicalApiId);
    const marker = decoded.lastIndexOf(":ret=");
    return marker < 0 ? "" : decoded.slice(marker + ":ret=".length);
}

function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let current = "";
    let depth = 0;
    for (const ch of value) {
        if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
        if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
        if (ch === "," && depth === 0) {
            parts.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function parameters(canonicalApiId: string): Array<{ index: number; type: string }> {
    const text = paramsText(canonicalApiId);
    if (text === "none" && decodeCanonical(canonicalApiId).includes(":invoke=property-write:")) {
        return [{ index: 0, type: returnType(canonicalApiId) }];
    }
    if (!text || text === "none") return [];
    return splitTopLevel(text).map(entry => {
        const colon = entry.indexOf(":");
        return {
            index: Number(entry.slice(0, colon)),
            type: entry.slice(colon + 1).replace(/^\?rest:/, "").replace(/^\?:/, "").replace(/^rest:/, ""),
        };
    });
}

function paramAt(canonicalApiId: string, index: number): string {
    return parameters(canonicalApiId).find(param => param.index === index)?.type || "";
}

function memberName(canonicalApiId: string): string {
    const decoded = decodeCanonical(canonicalApiId);
    return /:member=(?:function|method):(?:(?:instance|static):)?([^:]+)/.exec(decoded)?.[1] || "";
}

function endpointBases(value: unknown, out: any[] = []): any[] {
    if (!value || typeof value !== "object") return out;
    if (Array.isArray(value)) {
        value.forEach(item => endpointBases(item, out));
        return out;
    }
    const record = value as Json;
    if (record.base && typeof record.base === "object" && typeof record.base.kind === "string") {
        out.push(record.base);
    }
    Object.values(record).forEach(child => endpointBases(child, out));
    return out;
}

function bindings(file: string): Array<{ file: string; asset: Json; binding: Json; templates: Json[] }> {
    const asset = readJson(file);
    const templateById = new Map((asset.effectTemplates || []).map((template: Json) => [template.id, template]));
    return (asset.bindings || []).map((binding: Json) => ({
        file,
        asset,
        binding,
        templates: (binding.effectTemplateRefs || []).map((ref: string) => templateById.get(ref)).filter(Boolean),
    }));
}

function allRuleBindings(): Array<{ file: string; asset: Json; binding: Json; templates: Json[] }> {
    return [...bindings(SOURCE_FILE), ...bindings(SINK_FILE)];
}

function hasEndpoint(binding: Json, kind: string, index?: number): boolean {
    const base = binding.endpoint?.base;
    if (!base || base.kind !== kind) return false;
    return index === undefined || base.index === index;
}

function hasRestEndpoint(binding: Json, startIndex: number): boolean {
    const base = binding.endpoint?.base;
    return base?.kind === "rest" && base.startIndex === startIndex;
}

function hasAccessPath(binding: Json, path: string[]): boolean {
    const accessPath = binding.endpoint?.accessPath;
    return Array.isArray(accessPath) && accessPath.join(".") === path.join(".");
}

function templateHasAccessPath(template: Json, path: string[]): boolean {
    const accessPath = template.value?.accessPath;
    return Array.isArray(accessPath) && accessPath.join(".") === path.join(".");
}

function canonicalOf(binding: Json): string {
    return String(binding.canonicalApiId || "");
}

function assertNoLegacyOrFakeIds(): void {
    for (const file of [SOURCE_FILE, SINK_FILE]) {
        const asset = readJson(file);
        const text = JSON.stringify(asset);
        assert(!text.includes("\"selector\""), `${file} must not contain legacy selector`);
        assert(!text.includes("\"schemaVersion\""), `${file} must not contain schemaVersion`);
        assert(!text.includes("\"version\""), `${file} must not contain version governance field`);
        assert(!text.includes("\"tier\""), `${file} must not contain tier governance field`);
        for (const surface of asset.surfaces || []) {
            const id = String(surface.canonicalApiId || "");
            assert(id.startsWith("api:official:"), `${file} surface uses non-official canonicalApiId: ${id}`);
            assert(!id.includes("%unk") && !id.includes("@unk") && !id.includes("ret=unknown"), `${file} surface has fake ID evidence: ${id}`);
        }
        for (const binding of asset.bindings || []) {
            const id = String(binding.canonicalApiId || "");
            assert(id.startsWith("api:official:"), `${file} binding uses non-official canonicalApiId: ${id}`);
            assert(!id.includes("%unk") && !id.includes("@unk") && !id.includes("ret=unknown"), `${file} binding has fake ID evidence: ${id}`);
        }
    }
}

function assertEndpointProjectability(): void {
    const errors: string[] = [];
    for (const item of allRuleBindings()) {
        const id = canonicalOf(item.binding);
        const params = parameters(id);
        const ret = returnType(id);
        const targets = [item.binding.endpoint, ...item.templates];
        for (const base of targets.flatMap(target => endpointBases(target))) {
            if (base.kind === "arg" && (base.index < 0 || base.index >= params.length)) {
                errors.push(`${item.file}:${item.binding.bindingId}: arg${base.index} outside params ${paramsText(id)}`);
            }
            if (base.kind === "return" && ret === "void") {
                errors.push(`${item.file}:${item.binding.bindingId}: return endpoint on void API`);
            }
            if (base.kind === "promiseResult" && !/\bPromise\s*</.test(ret)) {
                errors.push(`${item.file}:${item.binding.bindingId}: promiseResult endpoint on ret=${ret}`);
            }
            if (base.kind === "callbackArg" && base.callback?.kind === "arg") {
                const callbackIndex = Number(base.callback.index);
                if (callbackIndex < 0 || callbackIndex >= params.length) {
                    errors.push(`${item.file}:${item.binding.bindingId}: callback arg${callbackIndex} outside params ${paramsText(id)}`);
                }
            }
        }
    }
    assert(errors.length === 0, `kernel official endpoints must be projectable:\n${errors.join("\n")}`);
}

function assertManualFamilyAudit(): void {
    const all = allRuleBindings();
    const sources = bindings(SOURCE_FILE);
    const sinks = bindings(SINK_FILE);
    const transfers = bindings(TRANSFER_FILE);

    const textBindings = sinks.filter(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes("component/ets/text.d.ts") && id.includes("TextInterface");
    });
    assert(textBindings.some(item => hasEndpoint(item.binding, "arg", 0)), "Text(...) must keep displayed value arg0 sink");
    assert(!textBindings.some(item => hasEndpoint(item.binding, "arg", 1)), "TextOptions must not be a display sink endpoint");

    const imageBindings = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("component/ets/image.d.ts"));
    assert(imageBindings.some(item => hasEndpoint(item.binding, "arg", 0)), "Image(...) must keep source image arg0 sink");
    assert(!imageBindings.some(item => paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ImageAIOptions")), "ImageAIOptions must not be an image payload sink");

    const routerSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.router"));
    for (const method of ["pushUrl", "replaceUrl", "back"]) {
        const routeSinks = routerSinks.filter(item => memberName(canonicalOf(item.binding)) === method && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("RouterOptions"));
        assert(routeSinks.some(item => hasEndpoint(item.binding, "arg", 0) && hasAccessPath(item.binding, ["url"])), `router.${method} must sink RouterOptions.url`);
        assert(routeSinks.some(item => hasEndpoint(item.binding, "arg", 0) && hasAccessPath(item.binding, ["params"])), `router.${method} must sink RouterOptions.params`);
        assert(!routeSinks.some(item => hasEndpoint(item.binding, "arg", 0) && !Array.isArray(item.binding.endpoint?.accessPath)), `router.${method} must not sink whole RouterOptions`);
        assert(!routeSinks.some(item => hasAccessPath(item.binding, ["recoverable"])), `router.${method} must not sink RouterOptions.recoverable`);
    }
    assert(routerSinks.some(item => memberName(canonicalOf(item.binding)) === "back" && hasEndpoint(item.binding, "arg", 1) && paramAt(canonicalOf(item.binding), 1).includes("Object")), "router.back(index, params) must sink params arg1");
    assert(!routerSinks.some(item => memberName(canonicalOf(item.binding)) === "back" && hasEndpoint(item.binding, "arg", 0) && paramAt(canonicalOf(item.binding), 0).includes("number")), "router.back(index, params) must not sink numeric index arg0");
    for (const method of ["push", "replace", "pushNamedRoute", "replaceNamedRoute"]) {
        assert(!routerSinks.some(item => memberName(canonicalOf(item.binding)) === method), `router.${method} is excluded by official declaration review and must not be a rule sink`);
    }
    assert(!routerSinks.some(item => memberName(canonicalOf(item.binding)) === "getStateByUrl"), "router.getStateByUrl is a state query and must not be a navigation sink");
    for (const method of ["enableAlertBeforeBackPage", "showAlertBeforeBackPage"]) {
        const alertSinks = routerSinks.filter(item => memberName(canonicalOf(item.binding)) === method);
        assert(alertSinks.some(item => hasEndpoint(item.binding, "arg", 0) && hasAccessPath(item.binding, ["message"])), `router.${method} must sink EnableAlertOptions.message only`);
        assert(!alertSinks.some(item => hasEndpoint(item.binding, "arg", 0) && !Array.isArray(item.binding.endpoint?.accessPath)), `router.${method} must not sink whole EnableAlertOptions`);
    }
    for (const method of ["clear", "disableAlertBeforeBackPage", "hideAlertBeforeBackPage"]) {
        assert(!routerSinks.some(item => memberName(canonicalOf(item.binding)) === method), `router.${method} has no payload endpoint and must not be a rule sink`);
    }
    assert(sources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.router") && memberName(canonicalOf(item.binding)) === "getParams" && hasEndpoint(item.binding, "return")), "router.getParams must source its return value");

    const cacheDownloadSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.request.cacheDownload") && memberName(canonicalOf(item.binding)) === "download");
    assert(cacheDownloadSinks.some(item => hasEndpoint(item.binding, "arg", 0)), "cacheDownload.download must sink target URL arg0");
    assert(cacheDownloadSinks.some(item => hasEndpoint(item.binding, "arg", 1) && hasAccessPath(item.binding, ["headers"])), "cacheDownload.download must sink CacheDownloadOptions.headers");
    assert(cacheDownloadSinks.some(item => hasEndpoint(item.binding, "arg", 1) && hasAccessPath(item.binding, ["caPath"])), "cacheDownload.download must sink CacheDownloadOptions.caPath");
    assert(!cacheDownloadSinks.some(item => hasEndpoint(item.binding, "arg", 1) && !Array.isArray(item.binding.endpoint?.accessPath)), "cacheDownload.download must not sink whole CacheDownloadOptions");
    assert(!cacheDownloadSinks.some(item => hasAccessPath(item.binding, ["sslType"])), "cacheDownload.download must not sink CacheDownloadOptions.sslType");

    const requestSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.request:"));
    assert(!requestSinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("request.agent.Task") && memberName(canonicalOf(item.binding)) === "start"), "request.agent.Task.start is a state trigger and must not be a receiver sink");

    const downloadConfigSinks = requestSinks.filter(item => paramAt(canonicalOf(item.binding), 0).includes("DownloadConfig") || paramAt(canonicalOf(item.binding), 1).includes("DownloadConfig"));
    for (const canonicalId of [...new Set(downloadConfigSinks.map(item => canonicalOf(item.binding)))]) {
        const configIndex = paramAt(canonicalId, 0).includes("DownloadConfig") ? 0 : 1;
        const overloadBindings = downloadConfigSinks.filter(item => canonicalOf(item.binding) === canonicalId);
        for (const field of ["url", "header", "filePath", "title", "description"]) {
            assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", configIndex) && hasAccessPath(item.binding, [field])), `DownloadConfig.${field} must be a field-level sink`);
        }
        assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", configIndex) && !Array.isArray(item.binding.endpoint?.accessPath)), "DownloadConfig must not be a whole-object sink");
        for (const field of ["enableMetered", "enableRoaming", "networkType", "background"]) {
            assert(!overloadBindings.some(item => hasAccessPath(item.binding, [field])), `DownloadConfig.${field} must not be a data sink`);
        }
    }

    const uploadConfigSinks = requestSinks.filter(item => paramAt(canonicalOf(item.binding), 0).includes("UploadConfig") || paramAt(canonicalOf(item.binding), 1).includes("UploadConfig"));
    for (const canonicalId of [...new Set(uploadConfigSinks.map(item => canonicalOf(item.binding)))]) {
        const configIndex = paramAt(canonicalId, 0).includes("UploadConfig") ? 0 : 1;
        const overloadBindings = uploadConfigSinks.filter(item => canonicalOf(item.binding) === canonicalId);
        for (const field of ["url", "header", "files", "data"]) {
            assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", configIndex) && hasAccessPath(item.binding, [field])), `UploadConfig.${field} must be a field-level sink`);
        }
        assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", configIndex) && !Array.isArray(item.binding.endpoint?.accessPath)), "UploadConfig must not be a whole-object sink");
        for (const field of ["method", "index", "begins", "ends"]) {
            assert(!overloadBindings.some(item => hasAccessPath(item.binding, [field])), `UploadConfig.${field} must not be a data sink`);
        }
    }

    const securityAssetSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.security.asset:"));
    assert(securityAssetSinks.some(item => memberName(canonicalOf(item.binding)) === "add" && hasEndpoint(item.binding, "arg", 0)), "asset.add must sink attributes arg0");
    assert(securityAssetSinks.some(item => memberName(canonicalOf(item.binding)) === "addAsUser" && hasEndpoint(item.binding, "arg", 0)), "asset.addAsUser must sink target userId arg0");
    assert(securityAssetSinks.some(item => memberName(canonicalOf(item.binding)) === "addAsUser" && hasEndpoint(item.binding, "arg", 1)), "asset.addAsUser must sink attributes arg1");
    assert(securityAssetSinks.some(item => memberName(canonicalOf(item.binding)) === "addSync" && hasEndpoint(item.binding, "arg", 0)), "asset.addSync must sink attributes arg0");
    for (const method of ["update", "updateSync"]) {
        const methodSinks = securityAssetSinks.filter(item => memberName(canonicalOf(item.binding)) === method);
        assert(methodSinks.some(item => hasEndpoint(item.binding, "arg", 0)), `asset.${method} must sink query selector arg0`);
        assert(methodSinks.some(item => hasEndpoint(item.binding, "arg", 1)), `asset.${method} must sink attributesToUpdate arg1`);
    }
    const updateAsUserSinks = securityAssetSinks.filter(item => memberName(canonicalOf(item.binding)) === "updateAsUser");
    for (const index of [0, 1, 2]) {
        assert(updateAsUserSinks.some(item => hasEndpoint(item.binding, "arg", index)), `asset.updateAsUser must sink arg${index}`);
    }

    const certManagerSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.security.certManager:"));
    for (const canonicalId of [...new Set(certManagerSinks.filter(item => memberName(canonicalOf(item.binding)) === "init").map(item => canonicalOf(item.binding)))]) {
        const initSinks = certManagerSinks.filter(item => canonicalOf(item.binding) === canonicalId);
        assert(initSinks.some(item => hasEndpoint(item.binding, "arg", 0)), "certificateManager.init must sink authUri arg0");
        assert(initSinks.some(item => hasEndpoint(item.binding, "arg", 1)), "certificateManager.init must sink CMSignatureSpec arg1");
        assert(!initSinks.some(item => hasEndpoint(item.binding, "arg", 2)), "certificateManager.init must not sink callback arg2");
    }
    for (const canonicalId of [...new Set(certManagerSinks.filter(item => memberName(canonicalOf(item.binding)) === "update").map(item => canonicalOf(item.binding)))]) {
        const updateSinks = certManagerSinks.filter(item => canonicalOf(item.binding) === canonicalId);
        assert(updateSinks.some(item => hasEndpoint(item.binding, "arg", 1)), "certificateManager.update must sink input data arg1");
        assert(!updateSinks.some(item => hasEndpoint(item.binding, "arg", 2)), "certificateManager.update must not sink callback arg2");
    }

    const cryptoFrameworkSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.security.cryptoFramework:"));
    for (const method of ["setCipherSpec", "setSignSpec", "setVerifySpec"]) {
        const specSinks = cryptoFrameworkSinks.filter(item => memberName(canonicalOf(item.binding)) === method);
        assert(specSinks.length > 0, `cryptoFramework.${method} must keep itemValue sink endpoints`);
        assert(specSinks.every(item => hasEndpoint(item.binding, "arg", 1)), `cryptoFramework.${method} must sink only itemValue arg1`);
        assert(!specSinks.some(item => hasEndpoint(item.binding, "arg", 0)), `cryptoFramework.${method} must not sink itemType arg0 selector`);
    }

    const huksSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.security.huks:"));
    for (const method of ["importKeyItemAsUser", "importWrappedKeyItemAsUser", "initSessionAsUser"]) {
        const methodSinks = huksSinks.filter(item => memberName(canonicalOf(item.binding)) === method);
        assert(methodSinks.some(item => hasEndpoint(item.binding, "arg", 0)), `huks.${method} must sink target userId arg0`);
    }
    for (const method of ["update", "updateSession"]) {
        const methodSinks = huksSinks.filter(item => memberName(canonicalOf(item.binding)) === method);
        assert(!methodSinks.some(item => hasEndpoint(item.binding, "arg", 0)), `huks.${method} must not sink opaque handle arg0`);
    }

    const taskpoolSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.taskpool:"));
    const taskpoolTransfers = transfers.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.taskpool:"));
    assert(taskpoolSinks.some(item => memberName(canonicalOf(item.binding)) === "sendData" && hasRestEndpoint(item.binding, 0)), "taskpool.Task.sendData must sink all payload rest args");
    for (const method of ["setTransferList", "setCloneList", "addDependency", "addTask"]) {
        assert(!taskpoolSinks.some(item => memberName(canonicalOf(item.binding)) === method), `taskpool.${method} must not be modeled as a terminal sink`);
    }
    assert(!taskpoolSinks.some(item => {
        const base = item.binding.endpoint?.base;
        return base?.kind === "arg" && paramAt(canonicalOf(item.binding), base.index).includes("Priority");
    }), "taskpool Priority parameters must not be data sinks");
    for (const method of ["executeDelayed", "executePeriodically"]) {
        assert(!taskpoolSinks.some(item => memberName(canonicalOf(item.binding)) === method && hasEndpoint(item.binding, "arg", 0)), `taskpool.${method} timing arg0 must not be a data sink`);
        assert(taskpoolSinks.some(item => memberName(canonicalOf(item.binding)) === method && hasEndpoint(item.binding, "arg", 1)), `taskpool.${method} must keep task arg1 sink`);
    }
    for (const method of ["setTransferList", "setCloneList", "addTask"]) {
        assert(taskpoolTransfers.some(item => {
            const id = decodeCanonical(canonicalOf(item.binding));
            const template = item.templates[0];
            return memberName(canonicalOf(item.binding)) === method &&
                template?.from?.base?.kind === "arg" &&
                template?.to?.base?.kind === "receiver" &&
                id.includes("module=@ohos.taskpool:");
        }), `taskpool.${method} carrier mutation must be modeled as arg -> receiver transfer`);
    }
    assert(taskpoolTransfers.some(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        const template = item.templates[0];
        return memberName(canonicalOf(item.binding)) === "addTask" &&
            template?.from?.base?.kind === "rest" &&
            template.from.base.startIndex === 1 &&
            template?.to?.base?.kind === "receiver" &&
            id.includes("0:Function,1:rest:Object[]");
    }), "taskpool.TaskGroup.addTask must transfer all rest args to the TaskGroup carrier");
    for (const method of ["execute"]) {
        assert(taskpoolSinks.some(item => {
            const base = item.binding.endpoint?.base;
            return memberName(canonicalOf(item.binding)) === method && base?.kind === "arg" && paramAt(canonicalOf(item.binding), base.index).includes("Task");
        }), "taskpool.execute must sink Task/TaskGroup carriers at execution boundary");
    }
    assert(taskpoolSinks.some(item => memberName(canonicalOf(item.binding)) === "execute" && hasRestEndpoint(item.binding, 1) && paramsText(canonicalOf(item.binding)).includes("0:Function,1:rest:Object[]")), "taskpool.execute(function, ...args) must sink all worker payload rest args");

    const rpcSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.rpc:"));
    assert(!rpcSinks.some(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return (id.includes("decl=class:rpc.MessageParcel") || id.includes("decl=class:rpc.MessageSequence")) && id.includes(":member=method:instance:write");
    }), "MessageParcel/MessageSequence write* methods must be transfers, not terminal IPC sinks");

    const rpcWriteTransfers = transfers.filter(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes("module=@ohos.rpc:") && (id.includes("decl=class:rpc.MessageParcel") || id.includes("decl=class:rpc.MessageSequence")) && id.includes(":member=method:instance:write");
    });
    assert(rpcWriteTransfers.length === 54, `MessageParcel/MessageSequence write* transfer count changed: ${rpcWriteTransfers.length}`);
    for (const item of rpcWriteTransfers) {
        const template = item.templates[0];
        assert(JSON.stringify(template?.from) === JSON.stringify({ base: { kind: "arg", index: 0 } }), "RPC write transfer must flow from arg0");
        assert(JSON.stringify(template?.to) === JSON.stringify({ base: { kind: "receiver" } }), "RPC write transfer must flow to receiver carrier");
    }

    const rpcSendSinks = rpcSinks.filter(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes(":member=method:instance:sendRequest") || id.includes(":member=method:instance:sendMessageRequest");
    });
    for (const canonicalId of [...new Set(rpcSendSinks.map(item => canonicalOf(item.binding)))]) {
        const overloadBindings = rpcSendSinks.filter(item => canonicalOf(item.binding) === canonicalId);
        assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", 0)), "RPC send* must sink request code arg0");
        assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", 1)), "RPC send* must sink outbound data arg1");
        assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", 2)), "RPC send* must not sink reply output arg2");
        assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", 3)), "RPC send* must not sink MessageOption control arg3");
    }
    assert(!rpcSinks.some(item => memberName(canonicalOf(item.binding)) === "addDeathRecipient"), "addDeathRecipient registers callbacks and must not be an IPC data sink");
    assert(!rpcSinks.some(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes("decl=class:rpc.MessageOption") && ["setFlags", "setAsync", "setWaitTime"].includes(memberName(canonicalOf(item.binding)));
    }), "MessageOption setters are request-mode controls and must not be data sinks");
    assert(rpcSinks.some(item => memberName(canonicalOf(item.binding)) === "setCallingIdentity" && hasEndpoint(item.binding, "arg", 0)), "IPCSkeleton.setCallingIdentity must keep identity arg0 sink");
    assert(!rpcSinks.some(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes("decl=class:rpc.Ashmem") && (memberName(canonicalOf(item.binding)) === "setProtection" || memberName(canonicalOf(item.binding)) === "setProtectionType");
    }), "Ashmem protection setters are controls and must not be data sinks");
    for (const method of ["writeToAshmem", "writeAshmem"]) {
        const ashmemWrites = rpcSinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("decl=class:rpc.Ashmem") && memberName(canonicalOf(item.binding)) === method);
        assert(ashmemWrites.some(item => hasEndpoint(item.binding, "arg", 0)), `Ashmem.${method} must sink data arg0`);
        assert(!ashmemWrites.some(item => hasEndpoint(item.binding, "arg", 1)), `Ashmem.${method} must not sink size arg1`);
        assert(!ashmemWrites.some(item => hasEndpoint(item.binding, "arg", 2)), `Ashmem.${method} must not sink offset arg2`);
    }
    assert(rpcSinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("decl=class:rpc.Ashmem") && memberName(canonicalOf(item.binding)) === "writeDataToAshmem" && hasEndpoint(item.binding, "arg", 0)), "Ashmem.writeDataToAshmem must keep ArrayBuffer arg0 sink");

    for (const method of ["debug", "info", "warn", "error", "fatal"]) {
        const methodBindings = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.hilog") && memberName(canonicalOf(item.binding)) === method);
        const canonicalIds = [...new Set(methodBindings.map(item => canonicalOf(item.binding)))];
        assert(canonicalIds.some(id => paramAt(id, 3).includes("any[]")), `hilog.${method} any[] overload must be modeled`);
        assert(canonicalIds.some(id => paramAt(id, 3).includes("RecordData[]")), `hilog.${method} RecordData[] overload must be modeled`);
        for (const canonicalId of canonicalIds) {
            const overloadBindings = methodBindings.filter(item => canonicalOf(item.binding) === canonicalId);
            assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", 0)), `hilog.${method} must not sink domain arg0`);
            for (const index of [1, 2]) {
                assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", index)), `hilog.${method} ${paramAt(canonicalId, 3)} overload must expose arg${index}`);
            }
            assert(overloadBindings.some(item => hasRestEndpoint(item.binding, 3)), `hilog.${method} ${paramAt(canonicalId, 3)} overload must expose all rest args from arg3`);
        }
    }
    for (const method of ["isLoggable", "setMinLogLevel", "setLogLevel"]) {
        assert(!sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.hilog") && memberName(canonicalOf(item.binding)) === method), `hilog.${method} must not be modeled as a sink`);
    }
    for (const method of ["debug", "log", "info", "warn", "error"]) {
        const consoleBindings = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("common/full/console.d.ts") && memberName(canonicalOf(item.binding)) === method);
        assert(consoleBindings.length > 0, `console.${method} must be modeled as a log sink`);
        assert(consoleBindings.some(item => hasEndpoint(item.binding, "arg", 0)), `console.${method} must expose message arg0`);
        assert(consoleBindings.some(item => hasRestEndpoint(item.binding, 1)), `console.${method} must expose all rest arguments from arg1`);
    }

    const faceAuthSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.userIAM.faceAuth"));
    assert(faceAuthSinks.some(item => memberName(canonicalOf(item.binding)) === "setSurfaceId" && hasEndpoint(item.binding, "arg", 0)), "FaceAuthManager.setSurfaceId must sink preview surfaceId arg0");

    const webviewSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.web.webview"));
    const geolocationSinks = webviewSinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("decl=class:webview.GeolocationPermissions"));
    for (const method of ["allowGeolocation", "deleteGeolocation"]) {
        const methodBindings = geolocationSinks.filter(item => memberName(canonicalOf(item.binding)) === method);
        assert(methodBindings.some(item => hasEndpoint(item.binding, "arg", 0)), `GeolocationPermissions.${method} must sink origin arg0`);
        assert(!methodBindings.some(item => hasEndpoint(item.binding, "arg", 1)), `GeolocationPermissions.${method} must not sink incognito control arg1`);
        assert(!methodBindings.some(item => paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("boolean")), `GeolocationPermissions.${method} boolean mode must not be a sink`);
    }
    const loadDataSinks = webviewSinks.filter(item => memberName(canonicalOf(item.binding)) === "loadData");
    for (const index of [0, 3, 4]) {
        assert(loadDataSinks.some(item => hasEndpoint(item.binding, "arg", index)), `WebviewController.loadData must sink arg${index}`);
    }
    for (const index of [1, 2]) {
        assert(!loadDataSinks.some(item => hasEndpoint(item.binding, "arg", index)), `WebviewController.loadData must not sink parser metadata arg${index}`);
    }
    const registerProxySinks = webviewSinks.filter(item => memberName(canonicalOf(item.binding)) === "registerJavaScriptProxy");
    for (const index of [0, 1, 2, 3, 4]) {
        assert(registerProxySinks.some(item => hasEndpoint(item.binding, "arg", index)), `registerJavaScriptProxy must sink bridge arg${index}`);
    }

    const workerSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=@ohos.worker"));
    assert(!workerSinks.some(item => memberName(canonicalOf(item.binding)) === "addEventListener"), "worker addEventListener registers callbacks and must not be an IPC payload sink");
    assert(workerSinks.some(item => memberName(canonicalOf(item.binding)) === "postMessage" && hasEndpoint(item.binding, "arg", 0)), "worker postMessage must sink message payload arg0");
    assert(workerSinks.some(item => memberName(canonicalOf(item.binding)) === "postMessage" && hasEndpoint(item.binding, "arg", 1) && paramAt(canonicalOf(item.binding), 1).includes("ArrayBuffer")), "worker postMessage must sink direct transfer list arg1");
    assert(workerSinks.some(item => memberName(canonicalOf(item.binding)) === "postMessageWithSharedSendable" && hasEndpoint(item.binding, "arg", 0)), "worker postMessageWithSharedSendable must sink message payload arg0");
    assert(workerSinks.some(item => memberName(canonicalOf(item.binding)) === "postMessageWithSharedSendable" && hasEndpoint(item.binding, "arg", 1)), "worker postMessageWithSharedSendable must sink transfer list arg1");
    const workerPostMessageOptionCanonicalIds = [...new Set(workerSinks
        .filter(item => memberName(canonicalOf(item.binding)) === "postMessage" && paramsText(canonicalOf(item.binding)).includes("PostMessageOptions"))
        .map(item => canonicalOf(item.binding)))];
    assert(workerPostMessageOptionCanonicalIds.length === 4, "worker PostMessageOptions overload coverage must include four SDK declarations");
    for (const canonicalId of workerPostMessageOptionCanonicalIds) {
        const overloadBindings = workerSinks.filter(item => canonicalOf(item.binding) === canonicalId);
        assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", 0)), "worker PostMessageOptions overload must keep message arg0 sink");
        const transferBindings = overloadBindings.filter(item => hasEndpoint(item.binding, "arg", 1));
        assert(transferBindings.some(item => hasAccessPath(item.binding, ["transfer"])), "worker PostMessageOptions must sink options.transfer");
        assert(!transferBindings.some(item => !Array.isArray(item.binding.endpoint?.accessPath)), "worker PostMessageOptions must not sink whole options arg1");
        assert(transferBindings.every(item => item.templates.every(template => templateHasAccessPath(template, ["transfer"]))), "worker PostMessageOptions templates must mirror options.transfer endpoint");
    }

    const uiAbilitySinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("module=api/application/UIAbilityContext.d.ts"));
    const startOptionsFields = [
        "windowMode",
        "displayId",
        "withAnimation",
        "windowLeft",
        "windowTop",
        "windowWidth",
        "windowHeight",
        "windowFocused",
        "processMode",
        "startupVisibility",
        "startWindowIcon",
        "startWindowBackgroundColor",
        "supportWindowModes",
        "minWindowWidth",
        "minWindowHeight",
        "maxWindowWidth",
        "maxWindowHeight",
        "hideStartWindow",
        "windowCreateParams",
    ];
    const uiAbilityStartOptionCanonicalIds = [...new Set(uiAbilitySinks
        .filter(item => paramsText(canonicalOf(item.binding)).includes("StartOptions"))
        .map(item => canonicalOf(item.binding)))];
    assert(uiAbilityStartOptionCanonicalIds.length === 12, `UIAbilityContext StartOptions overload coverage changed: ${uiAbilityStartOptionCanonicalIds.length}`);
    for (const canonicalId of uiAbilityStartOptionCanonicalIds) {
        const optionParam = parameters(canonicalId).find(param => param.type.includes("StartOptions"));
        assert(optionParam, "UIAbilityContext StartOptions canonical id must expose a StartOptions parameter");
        const optionBindings = uiAbilitySinks.filter(item => canonicalOf(item.binding) === canonicalId && hasEndpoint(item.binding, "arg", optionParam.index));
        for (const field of startOptionsFields) {
            assert(optionBindings.some(item => hasAccessPath(item.binding, [field])), `UIAbilityContext StartOptions.${field} must be a field-level sink`);
        }
        assert(!optionBindings.some(item => !Array.isArray(item.binding.endpoint?.accessPath)), "UIAbilityContext StartOptions must not be modeled as a whole-object sink");
        assert(!optionBindings.some(item => hasAccessPath(item.binding, ["completionHandler"])), "UIAbilityContext StartOptions.completionHandler must not be a sink");
        assert(optionBindings.every(item => item.templates.every(template => templateHasAccessPath(template, item.binding.endpoint?.accessPath || []))), "UIAbilityContext StartOptions templates must mirror field endpoints");
    }

    const withAccountMethods = [
        "startAbilityByCallWithAccount",
        "startAbilityWithAccount",
        "startAbilityForResultWithAccount",
        "startServiceExtensionAbilityWithAccount",
        "stopServiceExtensionAbilityWithAccount",
        "connectServiceExtensionAbilityWithAccount",
    ];
    const withAccountCanonicalIds = [...new Set(uiAbilitySinks
        .filter(item => withAccountMethods.includes(memberName(canonicalOf(item.binding))))
        .map(item => canonicalOf(item.binding)))];
    assert(withAccountCanonicalIds.length === 12, `UIAbilityContext WithAccount overload coverage changed: ${withAccountCanonicalIds.length}`);
    for (const canonicalId of withAccountCanonicalIds) {
        const overloadBindings = uiAbilitySinks.filter(item => canonicalOf(item.binding) === canonicalId);
        assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", 1)), "UIAbilityContext *WithAccount APIs must sink target accountId arg1");
    }
    assert(!uiAbilitySinks.some(item => memberName(canonicalOf(item.binding)) === "connectServiceExtensionAbility" && hasEndpoint(item.binding, "arg", 1)), "UIAbilityContext connectServiceExtensionAbility ConnectOptions callback object must not be a sink");
    assert(!uiAbilitySinks.some(item => memberName(canonicalOf(item.binding)) === "connectServiceExtensionAbilityWithAccount" && hasEndpoint(item.binding, "arg", 2)), "UIAbilityContext connectServiceExtensionAbilityWithAccount ConnectOptions callback object must not be a sink");
    assert(!uiAbilitySinks.some(item => memberName(canonicalOf(item.binding)) === "moveAbilityToBackground"), "UIAbilityContext moveAbilityToBackground has no payload endpoint and must not be a sink");

    const backToCallerSinks = uiAbilitySinks.filter(item => memberName(canonicalOf(item.binding)) === "backToCallerAbilityWithResult");
    assert(backToCallerSinks.some(item => hasEndpoint(item.binding, "arg", 0)), "UIAbilityContext backToCallerAbilityWithResult must sink AbilityResult arg0");
    assert(backToCallerSinks.some(item => hasEndpoint(item.binding, "arg", 1)), "UIAbilityContext backToCallerAbilityWithResult must sink requestCode arg1");

    const startByTypeCanonicalIds = [...new Set(uiAbilitySinks
        .filter(item => memberName(canonicalOf(item.binding)) === "startAbilityByType")
        .map(item => canonicalOf(item.binding)))];
    assert(startByTypeCanonicalIds.length === 2, `UIAbilityContext startAbilityByType overload coverage changed: ${startByTypeCanonicalIds.length}`);
    for (const canonicalId of startByTypeCanonicalIds) {
        const overloadBindings = uiAbilitySinks.filter(item => canonicalOf(item.binding) === canonicalId);
        assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", 0)), "UIAbilityContext startAbilityByType must sink type arg0");
        assert(overloadBindings.some(item => hasEndpoint(item.binding, "arg", 1)), "UIAbilityContext startAbilityByType must sink wantParam arg1");
        assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", 2)), "UIAbilityContext startAbilityByType AbilityStartCallback must not be a sink");
        assert(!overloadBindings.some(item => hasEndpoint(item.binding, "arg", 3)), "UIAbilityContext startAbilityByType AsyncCallback must not be a sink");
    }

    const openLinkSinks = uiAbilitySinks.filter(item => memberName(canonicalOf(item.binding)) === "openLink");
    assert(openLinkSinks.length > 0, "UIAbilityContext.openLink must be modeled as an official sink");
    assert(openLinkSinks.some(item => hasEndpoint(item.binding, "arg", 0)), "UIAbilityContext.openLink must sink link arg0");
    assert(openLinkSinks.some(item => hasEndpoint(item.binding, "arg", 1) && hasAccessPath(item.binding, ["parameters"])), "UIAbilityContext.openLink must sink OpenLinkOptions.parameters");
    assert(!openLinkSinks.some(item => hasEndpoint(item.binding, "arg", 1) && !Array.isArray(item.binding.endpoint?.accessPath)), "UIAbilityContext.openLink must not sink whole OpenLinkOptions");
    assert(!openLinkSinks.some(item => hasEndpoint(item.binding, "arg", 2)), "UIAbilityContext.openLink AsyncCallback must not be a sink");
    for (const field of ["appLinkingOnly", "completionHandler", "hideFailureTipDialog"]) {
        assert(!openLinkSinks.some(item => hasAccessPath(item.binding, [field])), `UIAbilityContext.openLink OpenLinkOptions.${field} must not be a sink`);
    }
    const openLinkParameterSinks = openLinkSinks.filter(item => hasEndpoint(item.binding, "arg", 1));
    assert(openLinkParameterSinks.every(item => item.templates.every(template => templateHasAccessPath(template, ["parameters"]))), "UIAbilityContext.openLink templates must mirror OpenLinkOptions.parameters");

    assert(sources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.net.http") && memberName(canonicalOf(item.binding)) === "request" && item.binding.endpoint?.base?.kind === "callbackArg"), "HTTP request callback response must be a source");
    assert(sources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.net.http") && memberName(canonicalOf(item.binding)) === "request" && hasEndpoint(item.binding, "promiseResult")), "HTTP request promise response must be a source");
    for (const method of ["request", "requestInStream"]) {
        const requestSinks = sinks.filter(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.net.http") && memberName(canonicalOf(item.binding)) === method);
        assert(requestSinks.some(item => hasEndpoint(item.binding, "arg", 0)), `HTTP ${method} URL arg0 must be a sink`);
        const optionSinks = requestSinks.filter(item => paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("HttpRequestOptions"));
        const optionSinksByCanonical = new Map<string, typeof optionSinks>();
        for (const item of optionSinks) {
            const key = canonicalOf(item.binding);
            const group = optionSinksByCanonical.get(key) || [];
            group.push(item);
            optionSinksByCanonical.set(key, group);
        }
        assert(optionSinksByCanonical.size === 2, `HTTP ${method} must model both HttpRequestOptions overloads`);
        const expectedOptionPaths = [
            ["extraData"],
            ["header"],
            ["caPath"],
            ["caData"],
            ["dnsOverHttps"],
            ["dnsServers"],
            ["multiFormDataList"],
            ["clientEncCert", "certPath"],
            ["clientEncCert", "keyPath"],
            ["clientEncCert", "keyPassword"],
            ["clientCert", "certPath"],
            ["clientCert", "keyPath"],
            ["clientCert", "keyPassword"],
            ["certificatePinning", "publicKeyHash"],
            ["serverAuthentication", "credential", "username"],
            ["serverAuthentication", "credential", "password"],
            ["usingProxy", "host"],
            ["usingProxy", "port"],
            ["usingProxy", "username"],
            ["usingProxy", "password"],
            ["usingProxy", "exclusionList"],
        ];
        const rejectedOptionPaths = [
            ["method"],
            ["expectDataType"],
            ["usingCache"],
            ["priority"],
            ["readTimeout"],
            ["connectTimeout"],
            ["usingProtocol"],
            ["sslType"],
            ["resumeFrom"],
            ["resumeTo"],
            ["maxLimit"],
            ["remoteValidation"],
            ["tlsOptions"],
            ["addressFamily"],
            ["usingProxy"],
            ["clientEncCert"],
            ["clientEncCert", "certType"],
            ["clientCert"],
            ["clientCert", "certType"],
            ["certificatePinning"],
            ["certificatePinning", "hashAlgorithm"],
            ["serverAuthentication"],
            ["serverAuthentication", "credential"],
            ["serverAuthentication", "authenticationType"],
        ];
        for (const [canonical, group] of optionSinksByCanonical) {
            for (const path of expectedOptionPaths) {
                assert(group.some(item => hasEndpoint(item.binding, "arg", 1) && hasAccessPath(item.binding, path)), `HTTP ${method} ${decodeCanonical(canonical)} options.${path.join(".")} must be a field sink`);
            }
            for (const path of rejectedOptionPaths) {
                assert(!group.some(item => hasEndpoint(item.binding, "arg", 1) && hasAccessPath(item.binding, path)), `HTTP ${method} options.${path.join(".")} must not be a payload sink`);
            }
            for (const item of group) {
                const accessPath = item.binding.endpoint?.accessPath;
                assert(Array.isArray(accessPath), `HTTP ${method} option sink must use a field accessPath`);
                assert(item.templates.every(template => templateHasAccessPath(template, accessPath)), `HTTP ${method} template must mirror options.${accessPath.join(".")}`);
            }
        }
        assert(!optionSinks.some(item => hasEndpoint(item.binding, "arg", 1) && !Array.isArray(item.binding.endpoint?.accessPath)), `HTTP ${method} HttpRequestOptions must not be modeled as whole-object arg1 sink`);
    }

    const rdbSinks = sinks.filter(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes("@ohos.data.relationalStore") || id.includes("@ohos.data.rdb");
    });
    const rdbSources = sources.filter(item => {
        const id = decodeCanonical(canonicalOf(item.binding));
        return id.includes("@ohos.data.relationalStore") || id.includes("@ohos.data.rdb") || id.includes("relationalStore.ResultSet");
    });
    for (const method of ["insert", "insertSync", "batchInsert", "batchInsertSync"]) {
        assert(rdbSinks.some(item => memberName(canonicalOf(item.binding)) === method && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ValuesBucket")), `RDB ${method} must sink ValuesBucket payloads`);
    }
    for (const method of ["update", "updateSync"]) {
        assert(rdbSinks.some(item => memberName(canonicalOf(item.binding)) === method && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ValuesBucket")), `RDB ${method} must sink ValuesBucket payloads`);
        assert(rdbSinks.some(item => memberName(canonicalOf(item.binding)) === method && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("Predicates")), `RDB ${method} must sink predicate boundary inputs`);
    }
    for (const method of ["querySql", "querySqlSync", "executeSql", "execute", "executeSync"]) {
        assert(rdbSinks.some(item => memberName(canonicalOf(item.binding)) === method && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("string")), `RDB ${method} must sink SQL string arg`);
    }
    assert(rdbSinks.some(item => memberName(canonicalOf(item.binding)) === "execute" && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("Array<ValueType>")), "RDB execute must sink bind value arrays");
    assert(!rdbSinks.some(item => ["query", "querySync"].includes(memberName(canonicalOf(item.binding)))), "RDB query/querySync must not be modeled as sinks; returned ResultSet is a source");
    assert(!rdbSinks.some(item => paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ConflictResolution")), "RDB ConflictResolution must not be modeled as payload sink");
    assert(!rdbSinks.some(item => paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("AsyncCallback")), "RDB callbacks must not be modeled as sinks");
    assert(rdbSources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("relationalStore.ResultSet") && memberName(canonicalOf(item.binding)) === "getString" && hasEndpoint(item.binding, "return")), "ResultSet.getString must source return");
    assert(rdbSources.some(item => memberName(canonicalOf(item.binding)) === "query" && (hasEndpoint(item.binding, "promiseResult") || item.binding.endpoint?.base?.kind === "callbackArg")), "RDB query must source returned ResultSet");
    assert(rdbSources.some(item => memberName(canonicalOf(item.binding)) === "querySql" && (hasEndpoint(item.binding, "promiseResult") || item.binding.endpoint?.base?.kind === "callbackArg")), "RDB querySql must source returned ResultSet");

    assert(sources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "readText" && hasEndpoint(item.binding, "promiseResult")), "fs.readText promise must source text");
    assert(sources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "readText" && item.binding.endpoint?.base?.kind === "callbackArg"), "fs.readText callback must source text");
    assert(sources.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "readTextSync" && hasEndpoint(item.binding, "return")), "fs.readTextSync must source return text");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "open" && hasEndpoint(item.binding, "arg", 0)), "fs.open must sink path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "openSync" && hasEndpoint(item.binding, "arg", 0)), "fs.openSync must sink path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "readText" && hasEndpoint(item.binding, "arg", 0)), "fs.readText must sink read path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "readTextSync" && hasEndpoint(item.binding, "arg", 0)), "fs.readTextSync must sink read path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "rmdir" && hasEndpoint(item.binding, "arg", 0)), "fs.rmdir must sink deleted path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "rmdirSync" && hasEndpoint(item.binding, "arg", 0)), "fs.rmdirSync must sink deleted path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "unlink" && hasEndpoint(item.binding, "arg", 0)), "fs.unlink must sink deleted path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "unlinkSync" && hasEndpoint(item.binding, "arg", 0)), "fs.unlinkSync must sink deleted path arg0");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "write" && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ArrayBuffer")), "fs.write must sink written payload");
    assert(sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && memberName(canonicalOf(item.binding)) === "writeSync" && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ArrayBuffer")), "fs.writeSync must sink written payload");
    assert(!sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && ["read", "readSync"].includes(memberName(canonicalOf(item.binding)))), "fs.read/readSync must not be modeled as sinks; returned byte count is only a source signal");
    assert(!sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("ReadTextOptions")), "fs ReadTextOptions must not be treated as path or payload sink");
    assert(!sinks.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("AsyncCallback")), "fs callbacks must not be modeled as sinks");
    assert(!all.some(item => decodeCanonical(canonicalOf(item.binding)).includes("@ohos.file.fs") && (memberName(canonicalOf(item.binding)) === "write" || memberName(canonicalOf(item.binding)) === "writeSync") && paramAt(canonicalOf(item.binding), item.binding.endpoint?.base?.index).includes("WriteOptions")), "fs WriteOptions must not be treated as written payload");
}

function main(): void {
    assertNoLegacyOrFakeIds();
    assertEndpointProjectability();
    assertManualFamilyAudit();
    console.log("PASS test_kernel_official_semantic_audit");
}

main();
