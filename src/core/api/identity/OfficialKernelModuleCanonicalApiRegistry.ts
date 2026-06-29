import type { AssetDocumentBase } from "../../assets/schema";
import abilityHandoffAsset from "../../../models/kernel/modules/harmony/ability_handoff";
import appStorageAsset from "../../../models/kernel/modules/harmony/appstorage";
import emitterAsset from "../../../models/kernel/modules/harmony/emitter";
import routerAsset from "../../../models/kernel/modules/harmony/router";
import stateAsset from "../../../models/kernel/modules/harmony/state";
import workerTaskpoolAssets from "../../../models/kernel/modules/harmony/worker_taskpool";
import tsjsContainerAsset from "../../../models/kernel/modules/tsjs/container";
import { assertValidCanonicalApiId } from "./CanonicalApiId";
import type { CanonicalApiDescriptorSeed } from "./CanonicalApiDescriptorFromId";

const officialKernelModuleAssets: AssetDocumentBase[] = [
    ...asAssetArray(abilityHandoffAsset),
    appStorageAsset,
    emitterAsset,
    routerAsset,
    stateAsset,
    ...asAssetArray(workerTaskpoolAssets),
    tsjsContainerAsset,
];

export function loadOfficialKernelModuleCanonicalApiDescriptorSeeds(): CanonicalApiDescriptorSeed[] {
    const canonicalApiIds = new Set<string>();
    for (const asset of officialKernelModuleAssets) {
        for (const surface of asset.surfaces || []) {
            if (!surface.canonicalApiId) {
                throw new Error(`kernel module asset ${asset.id} surface ${surface.surfaceId} is missing canonicalApiId`);
            }
            assertValidCanonicalApiId(surface.canonicalApiId);
            canonicalApiIds.add(surface.canonicalApiId.trim());
        }
    }
    return [...canonicalApiIds]
        .sort((left, right) => left.localeCompare(right))
        .map(canonicalApiId => ({ canonicalApiId }));
}

function asAssetArray(value: AssetDocumentBase | AssetDocumentBase[]): AssetDocumentBase[] {
    return Array.isArray(value) ? value : [value];
}
