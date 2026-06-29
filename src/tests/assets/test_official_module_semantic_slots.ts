import type { AssetDocumentBase } from "../../core/assets/schema";
import { validateAssetDocument } from "../../core/assets/schema";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import officialSemanticSlots from "../../models/kernel/modules/harmony/official_declaration_semantic_slots";
import { officialInvokeSurfaceFromId } from "../../models/kernel/moduleAssetHelpers";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertThrows(message: string, action: () => void): void {
    let threw = false;
    try {
        action();
    } catch {
        threw = true;
    }
    assert(threw, message);
}

const canonicalApiId = "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3Astring%2C1%3A%3F%3AEventData:ret=void";

function invalidUpdateStrengthHandoffAsset(): AssetDocumentBase {
    const surface = officialInvokeSurfaceFromId(canonicalApiId);
    return {
        id: "test.invalid_update_strength_handoff",
        plane: "module",
        status: "official",
        surfaces: [surface],
        bindings: [{
            bindingId: "binding:test.invalid_update_strength_handoff:emit",
            surfaceId: surface.surfaceId,
            canonicalApiId,
            assetId: "test.invalid_update_strength_handoff",
            plane: "module",
            role: "handoff",
            endpoint: { base: { kind: "arg", index: 1 } },
            effectTemplateRefs: ["template:test.invalid_update_strength_handoff:put"],
            semanticsFamily: "test.invalid-update-strength",
            completeness: "complete",
            confidence: "certain",
        }],
        effectTemplates: [{
            id: "template:test.invalid_update_strength_handoff:put",
            kind: "handoff.put",
            handle: {
                cellKind: "keyed-semantic-slot",
                family: "test.invalid-update-strength",
                key: [{ kind: "const", value: "shared" }],
                precision: "exact",
            },
            value: { base: { kind: "arg", index: 1 } },
            updateStrength: "unknown",
            confidence: "certain",
        } as any],
        provenance: {
            source: "builtin",
        },
    };
}

function main(): void {
    const assets = Array.isArray(officialSemanticSlots) ? officialSemanticSlots : [officialSemanticSlots];
    assert(assets.length === 0, "generated official declaration semantic slots must not be exported as trusted module assets");

    const invalid = invalidUpdateStrengthHandoffAsset();
    const validation = validateAssetDocument(invalid);
    assert(!validation.valid, "invalid handoff updateStrength assets must fail schema validation");
    assert(
        validation.errors.some(error => error.includes("updateStrength")),
        `expected updateStrength validation error, got: ${validation.errors.join("; ")}`,
    );
    assertThrows("invalid handoff updateStrength lowering must fail", () => lowerModuleAssetToInternalModuleLoweringIR(invalid));

    console.log("PASS test_official_module_semantic_slots generatedSlots=retired invalidUpdateStrength=rejected");
}

main();
