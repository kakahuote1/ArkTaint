import type { AssetDocumentBase } from "../../core/assets/schema";
import { validateAssetDocument } from "../../core/assets/schema";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import { modules as officialSemanticSlots } from "../../models/kernel/modules/harmony/official_semantic_slots";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertUnique(values: string[], label: string): void {
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    assert(duplicates.length === 0, `${label} contains duplicates: ${[...new Set(duplicates)].join(", ")}`);
}

function ids(assets: AssetDocumentBase[]): Set<string> {
    return new Set(assets.map(asset => asset.id));
}

function main(): void {
    const assets = Array.isArray(officialSemanticSlots) ? officialSemanticSlots : [officialSemanticSlots];
    const expected = [
        "harmony.file_uri",
        "harmony.rdb_datashare",
        "harmony.clipboard_unifieddata",
        "harmony.webview_bridge_state",
        "harmony.notification_form",
        "harmony.media_display",
        "harmony.common_event",
        "harmony.security_asset_state",
        "harmony.want_parameters",
        "harmony.message_parcel",
    ];
    const assetIds = ids(assets);
    for (const id of expected) {
        assert(assetIds.has(id), `missing official module semantic asset ${id}`);
    }

    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        assert(validation.valid, `${asset.id} must validate: ${validation.errors.join("; ")}`);
        assert(asset.plane === "module", `${asset.id} must be plane=module`);
        assert(asset.status === "official", `${asset.id} must be official`);
        assert(asset.provenance.source === "builtin", `${asset.id} must be builtin provenance`);
        assertUnique(asset.surfaces.map(surface => surface.surfaceId), `${asset.id} surfaces`);
        assertUnique(asset.bindings.map(binding => binding.bindingId), `${asset.id} bindings`);
        assertUnique((asset.effectTemplates || []).map(template => template.id), `${asset.id} templates`);
        assert((asset.effectTemplates || []).every(template =>
            template.kind === "handoff.put"
            || template.kind === "handoff.get"
            || template.kind === "handoff.kill",
        ), `${asset.id} must use declarative handoff templates only`);

        const lowered = lowerModuleAssetToInternalModuleLoweringIR(asset);
        assert(lowered.id === asset.id, `${asset.id} lowered id mismatch`);
        assert(lowered.semantics.length === 1, `${asset.id} should lower to one handoff_effect semantic bundle`);
        assert(lowered.semantics[0].kind === "handoff_effect", `${asset.id} must lower to handoff_effect consumer`);
    }

    const webview = assets.find(asset => asset.id === "harmony.webview_bridge_state")!;
    assert(
        (webview.effectTemplates || []).some(template => template.kind === "handoff.put" && template.id.includes("password.put")),
        "webview bridge must include password put semantics",
    );
    assert(
        (webview.effectTemplates || []).some(template => template.kind === "handoff.get" && template.id.includes("password.get")),
        "webview bridge must include password get semantics",
    );
    const commonEvent = assets.find(asset => asset.id === "harmony.common_event")!;
    assert(
        (commonEvent.effectTemplates || []).some(template => template.kind === "handoff.get" && template.id.includes("subscribe.get")),
        "common event must bridge callback payloads",
    );
    const parcel = assets.find(asset => asset.id === "harmony.message_parcel")!;
    assert(
        (parcel.effectTemplates || []).some(template => template.kind === "handoff.put" && template.id.includes("writeString.put")),
        "message parcel must include write semantics",
    );
    assert(
        (parcel.effectTemplates || []).some(template => template.kind === "handoff.get" && template.id.includes("readString.get")),
        "message parcel must include read semantics",
    );

    console.log(`PASS test_official_module_semantic_slots assets=${assets.length}`);
}

main();
