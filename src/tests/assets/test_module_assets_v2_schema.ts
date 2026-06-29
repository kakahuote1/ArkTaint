import type { AssetDocumentBase } from "../../core/assets/schema";
import { validateAssetDocument } from "../../core/assets/schema";
import { parseCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import { canonicalApiDescriptorFromIdSeed } from "../../core/api/identity/CanonicalApiDescriptorFromId";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import abilityHandoff from "../../models/kernel/modules/harmony/ability_handoff";
import appstorage from "../../models/kernel/modules/harmony/appstorage";
import emitter from "../../models/kernel/modules/harmony/emitter";
import officialDeclarationSemanticSlots from "../../models/kernel/modules/harmony/official_declaration_semantic_slots";
import router from "../../models/kernel/modules/harmony/router";
import state from "../../models/kernel/modules/harmony/state";
import workerTaskpool from "../../models/kernel/modules/harmony/worker_taskpool";
import container from "../../models/kernel/modules/tsjs/container";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flatten(value: AssetDocumentBase | AssetDocumentBase[]): AssetDocumentBase[] {
    return Array.isArray(value) ? value : [value];
}

function collectCanonicalApiIds(value: unknown): string[] {
    const ids = new Set<string>();
    JSON.stringify(value, (key, child) => {
        if (key === "canonicalApiId" && typeof child === "string") ids.add(child);
        if (key.endsWith("CanonicalApiIds") && Array.isArray(child)) {
            child.forEach(item => {
                if (typeof item === "string") ids.add(item);
            });
        }
        return child;
    });
    return [...ids].sort((left, right) => left.localeCompare(right));
}

function canonicalParameterTypes(canonicalApiId: string): string[] {
    const decoded = decodeURIComponent(canonicalApiId);
    const match = decoded.match(/:params=(.*):ret=/);
    if (!match || match[1] === "none") return [];
    return match[1].split(",").map(part => {
        const separator = part.lastIndexOf(":");
        return separator >= 0 ? part.slice(separator + 1).trim() : "";
    });
}

function assertOfficialCanonicalApiId(canonicalApiId: string, context: string): void {
    const parsed = parseCanonicalApiId(canonicalApiId);
    assert(parsed, `${context} must be a parseable canonicalApiId`);
    assert(parsed.authority === "official", `${context} must be backed by official declaration authority`);
    assert(parsed.module !== "local", `${context} must not use local placeholder module`);
    assert(parsed.file !== "local" && !parsed.file.endsWith("/local.d.ts"), `${context} must not use local placeholder file`);
    assert(parsed.ret.trim().toLowerCase() !== "unknown", `${context} must not use unknown return type`);
    const descriptor = canonicalApiDescriptorFromIdSeed({ canonicalApiId });
    assert(descriptor.provenance.source === "official-declaration", `${context} must resolve as official declaration`);
}

function assertArgProjectable(canonicalApiId: string, index: number, context: string): void {
    assert(Number.isInteger(index) && index >= 0, `${context} must use a non-negative arg index`);
    const descriptor = canonicalApiDescriptorFromIdSeed({ canonicalApiId });
    assert(
        descriptor.signature.parameters.some(parameter => parameter.index === index),
        `${context} index ${index} is not projectable for ${canonicalApiId}`,
    );
}

function assertSurfaceBindingIdentityClosure(asset: AssetDocumentBase): void {
    const surfaceIds = new Set<string>();
    const surfaceCanonicalIds = new Set<string>();
    for (const [index, surface] of asset.surfaces.entries()) {
        surfaceIds.add(surface.surfaceId);
        assert(surface.canonicalApiId, `${asset.id} surface ${surface.surfaceId} must declare canonicalApiId`);
        assertOfficialCanonicalApiId(surface.canonicalApiId, `${asset.id} surface[${index}]`);
        surfaceCanonicalIds.add(surface.canonicalApiId);
        if (surface.kind === "invoke" || surface.kind === "construct") {
            const descriptor = canonicalApiDescriptorFromIdSeed({ canonicalApiId: surface.canonicalApiId });
            assert(descriptor.arkanalyzer, `${asset.id} ${surface.surfaceId} must have projectable Arkanalyzer method evidence`);
            assert(
                !!surface.evidence?.arkanalyzer?.methodKey,
                `${asset.id} ${surface.surfaceId} must carry methodKey evidence on invoke/construct surface`,
            );
        }
        if (surface.kind === "decorator") {
            const parsed = parseCanonicalApiId(surface.canonicalApiId);
            assert(parsed?.invoke === "decorator", `${asset.id} ${surface.surfaceId} decorator must use decorator invoke kind`);
        }
    }

    const templateIds = new Set((asset.effectTemplates || []).map(template => template.id));
    for (const binding of asset.bindings) {
        assert(surfaceIds.has(binding.surfaceId), `${asset.id} binding ${binding.bindingId} references missing surface`);
        assert(binding.canonicalApiId, `${asset.id} binding ${binding.bindingId} must declare canonicalApiId`);
        assertOfficialCanonicalApiId(binding.canonicalApiId, `${asset.id} binding ${binding.bindingId}`);
        const surface = asset.surfaces.find(item => item.surfaceId === binding.surfaceId);
        assert(surface?.canonicalApiId === binding.canonicalApiId, `${asset.id} binding ${binding.bindingId} canonicalApiId must match surface`);
        for (const ref of binding.effectTemplateRefs || []) {
            assert(templateIds.has(ref), `${asset.id} binding ${binding.bindingId} references missing template ${ref}`);
        }
    }

    for (const template of asset.effectTemplates || []) {
        for (const canonicalApiId of collectCanonicalApiIds(template)) {
            assert(
                surfaceCanonicalIds.has(canonicalApiId),
                `${asset.id} template ${template.id} references canonicalApiId outside declared surfaces`,
            );
        }
    }
}

function assertPayloadApiGroupIndexes(group: unknown, fields: string[], context: string): void {
    assert(Array.isArray(group), `${context} must be an array`);
    for (const [index, item] of group.entries()) {
        const canonicalApiIds = Array.isArray((item as any)?.canonicalApiIds) ? (item as any).canonicalApiIds : [];
        assert(canonicalApiIds.length > 0, `${context}[${index}] must bind at least one canonicalApiId`);
        for (const canonicalApiId of canonicalApiIds) {
            assertOfficialCanonicalApiId(canonicalApiId, `${context}[${index}]`);
            for (const field of fields) {
                if ((item as any)[field] !== undefined) {
                    assertArgProjectable(canonicalApiId, (item as any)[field], `${context}[${index}].${field}`);
                }
            }
        }
    }
}

function assertModuleSemanticShape(asset: AssetDocumentBase): void {
    const templates = asset.effectTemplates || [];
    if (asset.id === "harmony.ability_handoff") {
        assert(templates.length === 1 && templates[0].kind === "core.capability", "ability_handoff must use one core capability template");
        assert((templates[0] as any).capability === "module.ability-handoff", "ability_handoff capability mismatch");
        const payload = (templates[0] as any).payload || {};
        assert(Array.isArray(payload.startCanonicalApiIds) && payload.startCanonicalApiIds.length > 0, "ability_handoff start APIs missing");
        assert(Array.isArray(payload.targetCanonicalApiIds) && payload.targetCanonicalApiIds.length > 0, "ability_handoff target APIs missing");
        for (const canonicalApiId of payload.startCanonicalApiIds as string[]) {
            assert(
                canonicalParameterTypes(canonicalApiId)[0] === "Want",
                `ability_handoff start API must pass handoff Want as arg0: ${canonicalApiId}`,
            );
        }
        for (const canonicalApiId of payload.targetCanonicalApiIds as string[]) {
            assert(
                canonicalParameterTypes(canonicalApiId).some(type => type === "Want"),
                `ability_handoff target API must declare an exact Want parameter: ${canonicalApiId}`,
            );
        }
        return;
    }
    if (asset.id === "harmony.appstorage") {
        assert(templates.length === 1 && templates[0].kind === "core.capability", "appstorage must use one core capability template");
        assert((templates[0] as any).capability === "module.keyed-storage", "appstorage capability mismatch");
        const payload = (templates[0] as any).payload || {};
        assertPayloadApiGroupIndexes(payload.writeApis, ["valueIndex"], "appstorage.writeApis");
        assertPayloadApiGroupIndexes(payload.writeResultApis, ["valueIndex"], "appstorage.writeResultApis");
        assert(
            Array.isArray(payload.writeResultApis) && payload.writeResultApis.length > 0,
            "appstorage setAnd* wrapper-returning APIs must be modeled explicitly as writeResultApis",
        );
        for (const api of payload.writeApis as any[]) {
            for (const canonicalApiId of api.canonicalApiIds || []) {
                const memberName = canonicalApiDescriptorFromIdSeed({ canonicalApiId }).member.name;
                assert(
                    memberName !== "setAndRef" && memberName !== "setAndLink" && memberName !== "setAndProp",
                    "appstorage setAnd* wrapper-returning APIs must not be modeled as plain writeApis",
                );
            }
        }
        for (const api of payload.writeResultApis as any[]) {
            assert(api.valueIndex === 1, "appstorage setAnd* defaultValue must be arg1");
            assert(api.updateStrength === "weak", "appstorage setAnd* defaultValue write must be weak create-if-missing semantics");
            for (const canonicalApiId of api.canonicalApiIds || []) {
                const memberName = canonicalApiDescriptorFromIdSeed({ canonicalApiId }).member.name;
                assert(
                    memberName === "setAndRef" || memberName === "setAndLink" || memberName === "setAndProp",
                    `appstorage.writeResultApis must contain only setAnd* APIs: ${canonicalApiId}`,
                );
                const params = canonicalParameterTypes(canonicalApiId);
                assert(params[0] === "string", `appstorage setAnd* key must be arg0 string: ${canonicalApiId}`);
                assert(params.length >= 2, `appstorage setAnd* must declare arg1 defaultValue: ${canonicalApiId}`);
            }
        }
        assert(Array.isArray(payload.readCanonicalApiIds) && payload.readCanonicalApiIds.length > 0, "appstorage read APIs missing");
        assert(Array.isArray(payload.killCanonicalApiIds) && payload.killCanonicalApiIds.length > 0, "appstorage kill APIs missing");
        assert(Array.isArray(payload.propDecoratorCanonicalApiIds), "appstorage prop decorators must be explicit");
        assert(Array.isArray(payload.linkDecoratorCanonicalApiIds), "appstorage link decorators must be explicit");
        return;
    }
    if (asset.id === "harmony.emitter") {
        assert(templates.length === 2, "emitter must keep one template per payload argument shape");
        for (const template of templates as any[]) {
            assert(template.kind === "module.eventEmitter", "emitter must use module.eventEmitter templates");
            assert(Array.isArray(template.onCanonicalApiIds) && template.onCanonicalApiIds.length > 0, "emitter on APIs missing");
            assert(Array.isArray(template.emitCanonicalApiIds) && template.emitCanonicalApiIds.length > 0, "emitter emit APIs missing");
            for (const canonicalApiId of [...template.onCanonicalApiIds, ...template.emitCanonicalApiIds]) {
                assert(!decodeURIComponent(canonicalApiId).includes("params=0:InnerEvent"), "emitter InnerEvent overloads require explicit eventId channel-field semantics before becoming active");
            }
            for (const canonicalApiId of template.onCanonicalApiIds) {
                assertArgProjectable(canonicalApiId, template.callbackArgIndex, `${asset.id}.${template.id}.callbackArgIndex`);
                for (const channelIndex of template.channelArgIndexes || []) {
                    assertArgProjectable(canonicalApiId, channelIndex, `${asset.id}.${template.id}.channelArgIndexes`);
                }
            }
            for (const canonicalApiId of template.emitCanonicalApiIds) {
                assertArgProjectable(canonicalApiId, template.payloadArgIndex, `${asset.id}.${template.id}.payloadArgIndex`);
                for (const channelIndex of template.channelArgIndexes || []) {
                    assertArgProjectable(canonicalApiId, channelIndex, `${asset.id}.${template.id}.channelArgIndexes`);
                }
            }
        }
        return;
    }
    if (asset.id === "harmony.router") {
        assert(templates.length === 1 && templates[0].kind === "core.capability", "router must use one core capability template");
        assert((templates[0] as any).capability === "module.route-bridge", "router capability mismatch");
        const payload = (templates[0] as any).payload || {};
        assertPayloadApiGroupIndexes(payload.pushApis, ["routeArgIndex", "payloadArgIndex"], "router.pushApis");
        assert(Array.isArray(payload.getCanonicalApiIds) && payload.getCanonicalApiIds.length > 0, "router getParams APIs missing");
        assertPayloadApiGroupIndexes(payload.getApis || [], ["routeArgIndex"], "router.getApis");
        assert(
            (payload.getApis || []).some((api: any) =>
                (api.canonicalApiIds || []).some((canonicalApiId: string) =>
                    decodeURIComponent(canonicalApiId).includes("getParamByName"),
                ) && api.routeArgIndex === 0 && api.routeField === "name",
            ),
            "router getParamByName APIs must be modeled as exact name-arg keyed reads",
        );
        assert(
            !(payload.getCanonicalApiIds || []).some((canonicalApiId: string) =>
                decodeURIComponent(canonicalApiId).includes("getParamByName"),
            ),
            "router getParamByName must not be modeled as an unscoped getCanonicalApiIds read",
        );
        assertPayloadApiGroupIndexes(payload.navDestinationRegisterApis, ["callbackArgIndex"], "router.navDestinationRegisterApis");
        assert(
            payload.navDestinationRegisterApis.some((api: any) =>
                (api.canonicalApiIds || []).some((canonicalApiId: string) =>
                    decodeURIComponent(canonicalApiId).includes("PageMapBuilder | undefined"),
                ),
            ),
            "router navDestination register APIs must include the PageMapBuilder overload explicitly",
        );
        assertPayloadApiGroupIndexes(payload.navDestinationTriggerApis, ["routeArgIndex", "payloadArgIndex"], "router.navDestinationTriggerApis");
        return;
    }
    if (asset.id === "harmony.state") {
        assert(templates.length === 1 && templates[0].kind === "core.capability", "state must use one core capability template");
        assert((templates[0] as any).capability === "module.state-binding", "state capability mismatch");
        const payload = (templates[0] as any).payload || {};
        for (const field of [
            "stateDecoratorCanonicalApiIds",
            "propDecoratorCanonicalApiIds",
            "linkDecoratorCanonicalApiIds",
            "provideDecoratorCanonicalApiIds",
            "consumeDecoratorCanonicalApiIds",
        ]) {
            assert(Array.isArray(payload[field]), `state ${field} must be explicit`);
        }
        return;
    }
    if (asset.id.startsWith("harmony.taskpool_execute.")) {
        assert(templates.length === 1 && templates[0].kind === "core.capability", "taskpool must use one core capability template per overload");
        assert((templates[0] as any).capability === "module.bridge", "taskpool capability mismatch");
        const bridge = (templates[0] as any).payload?.bridge;
        assert(bridge?.from?.slot === "arg", "taskpool bridge must source execute rest args");
        assert(bridge?.to?.slot === "callback_param", "taskpool bridge must target execute callback params");
        assert(bridge.from.rest === true, "taskpool bridge source must model execute rest args explicitly");
        assert(bridge.to.rest === true, "taskpool bridge target must map rest args to callback params explicitly");
        const fromId = bridge.from.surface.canonicalApiId;
        const toId = bridge.to.surface.canonicalApiId;
        assert(fromId === toId, "taskpool bridge source/target must stay on the same execute overload");
        assertArgProjectable(fromId, bridge.from.index, `${asset.id}.bridge.from.index`);
        assertArgProjectable(toId, bridge.to.callbackArgIndex, `${asset.id}.bridge.to.callbackArgIndex`);
        return;
    }
    if (asset.id === "tsjs.container") {
        assert(templates.length === 1 && templates[0].kind === "core.capability", "tsjs.container must use one core capability template");
        assert((templates[0] as any).capability === "module.container", "tsjs.container capability mismatch");
        const payload = (templates[0] as any).payload || {};
        assert(Array.isArray(payload.mutationCanonicalApiIds) && payload.mutationCanonicalApiIds.length > 0, "container mutation APIs missing");
        assert(Array.isArray(payload.accessCanonicalApiIds) && payload.accessCanonicalApiIds.length > 0, "container access APIs missing");
        for (const canonicalApiId of payload.accessCanonicalApiIds as string[]) {
            const parsed = parseCanonicalApiId(canonicalApiId);
            assert(parsed?.ret.trim().toLowerCase() !== "boolean", `container access API must return readable content, not boolean predicate: ${canonicalApiId}`);
        }
        return;
    }
    throw new Error(`unexpected module asset id ${asset.id}`);
}

function main(): void {
    assert(
        flatten(officialDeclarationSemanticSlots).length === 0,
        "official_declaration_semantic_slots must remain an empty retired catalog without pseudo API IDs",
    );
    assert(
        flatten(abilityHandoff).length === 0,
        "ability_handoff must remain retired until exact Want target Ability resolution is implemented",
    );
    const assets = [
        ...flatten(abilityHandoff),
        ...flatten(appstorage),
        ...flatten(emitter),
        ...flatten(officialDeclarationSemanticSlots),
        ...flatten(router),
        ...flatten(state),
        ...flatten(workerTaskpool),
        ...flatten(container),
    ];
    assert(assets.length >= 7, "expected built-in active module assets");

    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        assert(validation.valid, `${asset.id} failed asset validation: ${validation.errors.join("; ")}`);
        assert(asset.plane === "module", `${asset.id} must be plane=module`);
        assert(asset.status === "official", `${asset.id} must be official`);
        assert(asset.surfaces.length > 0, `${asset.id} must declare surfaces`);
        assert(asset.bindings.length > 0, `${asset.id} must declare bindings`);
        assert(
            (asset.effectTemplates || []).every(template =>
                template.kind === "core.capability"
                || template.kind === "handoff.put"
                || template.kind === "handoff.get"
                || template.kind === "handoff.kill"
                || template.kind === "module.eventEmitter",
            ),
            `${asset.id} should only use controlled module semantic templates`,
        );

        const serialized = JSON.stringify(asset);
        for (const forbidden of ["schemaVersion", "coverageSurfaces", "semanticsRef", "semantics.effects", "\"semantics\""]) {
            assert(!serialized.includes(forbidden), `${asset.id} contains forbidden legacy marker ${forbidden}`);
        }
        for (const forbidden of ["api:internal", "ret=unknown", "%unk", "@unk", "unknown_owner", "\"selector\"", "\"tier\"", "\"version\"", "\"modelVersion\"", "\"assetVersion\""]) {
            assert(!serialized.includes(forbidden), `${asset.id} contains forbidden pseudo/legacy marker ${forbidden}`);
        }
        for (const canonicalApiId of collectCanonicalApiIds(asset)) {
            assertOfficialCanonicalApiId(canonicalApiId, `${asset.id} canonicalApiId`);
        }
        assertSurfaceBindingIdentityClosure(asset);
        assertModuleSemanticShape(asset);

        const lowered = lowerModuleAssetToInternalModuleLoweringIR(asset);
        assert(lowered.id === asset.id, `${asset.id} lowered id mismatch`);
        if ((asset.effectTemplates || []).every(template => template.kind === "core.capability" || template.kind === "module.eventEmitter")) {
            assert(lowered.semantics.length === (asset.effectTemplates || []).length, `${asset.id} lowered semantic count mismatch`);
        } else {
            assert(lowered.semantics.length > 0, `${asset.id} should lower handoff templates to at least one semantic bundle`);
            assert(
                lowered.semantics.every(semantic => semantic.kind === "handoff_effect" || semantic.kind === "keyed_storage"),
                `${asset.id} handoff templates should lower only to handoff_effect/keyed_storage semantics`,
            );
        }
    }

    const appstorageAsset = flatten(appstorage)[0] as any;
    const appstorageCapability = appstorageAsset.effectTemplates?.find(
        (template: any) => template.id === "template:harmony.appstorage:capability",
    );
    const activeAppStorageIds = collectCanonicalApiIds(appstorageCapability?.payload || {});
    for (const canonicalApiId of activeAppStorageIds) {
        const descriptor = canonicalApiDescriptorFromIdSeed({ canonicalApiId });
        const memberName = descriptor.member.name;
        const params = canonicalParameterTypes(canonicalApiId);
        assert(memberName !== "putBatch", "harmony.appstorage must not model batch writes as single-key keyed-storage");
        assert(memberName !== "getEntries" && memberName !== "getAll" && memberName !== "getAllSync", "harmony.appstorage must not model whole-store reads as single-key keyed-storage");
        assert(memberName !== "clear" && memberName !== "clearSync", "harmony.appstorage must not model whole-store clears as single-key keyed-storage");
        assert(memberName !== "deleteBatch" && memberName !== "deleteKVStore" && memberName !== "removeDeviceData", "harmony.appstorage must not model batch/device/store-scope kills as single-key keyed-storage");
        if (memberName === "delete" || memberName === "deleteSync" || memberName === "put" || memberName === "putSync" || memberName === "get" || memberName === "getSync") {
            assert(params[0] === "string", `harmony.appstorage single-key API must use arg0 string key: ${canonicalApiId}`);
        }
    }

    console.log(`PASS test_module_assets_v2_schema assets=${assets.length}`);
}

main();
