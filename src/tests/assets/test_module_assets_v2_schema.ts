import type { AssetDocumentBase } from "../../core/assets/schema";
import { validateAssetDocument } from "../../core/assets/schema";
import { lowerModuleAssetToModuleRuntimeSpec } from "../../core/kernel/contracts/ModuleAssetLowering";
import abilityHandoff from "../../models/kernel/modules/harmony/ability_handoff";
import appstorage from "../../models/kernel/modules/harmony/appstorage";
import emitter from "../../models/kernel/modules/harmony/emitter";
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

function main(): void {
    const assets = [
        ...flatten(abilityHandoff),
        ...flatten(appstorage),
        ...flatten(emitter),
        ...flatten(router),
        ...flatten(state),
        ...flatten(workerTaskpool),
        ...flatten(container),
    ];
    assert(assets.length >= 7, "expected built-in module assets");

    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        assert(validation.valid, `${asset.id} failed asset validation: ${validation.errors.join("; ")}`);
        assert(asset.plane === "module", `${asset.id} must be plane=module`);
        assert(asset.status === "official", `${asset.id} must be official`);
        assert(asset.surfaces.length > 0, `${asset.id} must declare surfaces`);
        assert(asset.bindings.length > 0, `${asset.id} must declare bindings`);
        assert((asset.effectTemplates || []).every(template => template.kind === "core.capability"), `${asset.id} should only use controlled core capability templates`);

        const serialized = JSON.stringify(asset);
        for (const forbidden of ["schemaVersion", "coverageSurfaces", "semanticsRef", "semantics.effects", "\"semantics\""]) {
            assert(!serialized.includes(forbidden), `${asset.id} contains forbidden legacy marker ${forbidden}`);
        }

        const lowered = lowerModuleAssetToModuleRuntimeSpec(asset);
        assert(lowered.id === asset.id, `${asset.id} lowered id mismatch`);
        assert(lowered.semantics.length === (asset.effectTemplates || []).length, `${asset.id} lowered semantic count mismatch`);
    }

    console.log(`PASS test_module_assets_v2_schema assets=${assets.length}`);
}

main();
