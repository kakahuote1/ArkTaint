import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(): AssetDocumentBase {
    const file = path.resolve("src/models/kernel/rules/transfers/official_structured.rules.json");
    return JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
}

function findBinding(asset: AssetDocumentBase, text: string): AssetDocumentBase["bindings"][number] {
    const binding = asset.bindings.find(item => item.canonicalApiId.includes(text));
    assert(binding, `missing binding for ${text}`);
    return binding;
}

function templateFor(asset: AssetDocumentBase, binding: AssetDocumentBase["bindings"][number]): any {
    const ref = binding.effectTemplateRefs[0];
    const template = asset.effectTemplates.find(item => item.id === ref);
    assert(template, `missing template ${ref}`);
    return template;
}

function endpointKey(endpoint: any): string {
    if (endpoint?.endpoint) return endpointKey(endpoint.endpoint);
    const base = endpoint?.base;
    if (!base) return "<missing>";
    const suffix = endpoint.accessPath?.length ? `.${endpoint.accessPath.join(".")}` : "";
    if (base.kind === "arg") return `arg${base.index}${suffix}`;
    return `${base.kind}${suffix}`;
}

function main(): void {
    const asset = loadAsset();
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `official structured transfer asset must validate: ${validation.errors.join("; ")}`);
    assert(asset.status === "official", "official structured transfer asset must be official");
    assert(asset.plane === "rule", "official structured transfer asset must be a rule asset");

    assert(asset.surfaces.length === 29, `expected 29 structured official surfaces, got ${asset.surfaces.length}`);
    assert(asset.bindings.length === 31, `expected 31 structured official bindings, got ${asset.bindings.length}`);
    assert(asset.effectTemplates.length === 31, `expected 31 structured official templates, got ${asset.effectTemplates.length}`);
    for (const surface of asset.surfaces) {
        assert(surface.canonicalApiId.startsWith("api:official:"), `${surface.surfaceId} must bind an official canonical API`);
    }
    for (const binding of asset.bindings) {
        assert(binding.role === "transfer", `${binding.bindingId} must be a transfer binding`);
        assert(binding.canonicalApiId.startsWith("api:official:"), `${binding.bindingId} must bind an official canonical API`);
        assert(binding.effectTemplateRefs.length > 0, `${binding.bindingId} must reference a template`);
    }

    const urlSet = findBinding(asset, "URLSearchParams:member=method%3Ainstance%3Aset");
    const urlSetTemplate = templateFor(asset, urlSet);
    assert(endpointKey(urlSetTemplate.from) === "arg1", "URLSearchParams.set must transfer value arg1");
    assert(endpointKey(urlSetTemplate.to) === "receiver", "URLSearchParams.set must write into receiver slot");
    assert(urlSetTemplate.to?.slotKind === "url-search-param", "URLSearchParams.set must use url-search-param slot");
    assert(!urlSetTemplate.to?.slotWriteMode, "URLSearchParams.set must keep default replace slot write mode");

    const urlAppend = findBinding(asset, "URLSearchParams:member=method%3Ainstance%3Aappend");
    const urlAppendTemplate = templateFor(asset, urlAppend);
    assert(urlAppendTemplate.to?.slotWriteMode === "append", "URLSearchParams.append must declare append slot write mode");

    const urlStringify = findBinding(asset, "URLSearchParams:member=method%3Ainstance%3AtoString");
    const urlStringifyTemplate = templateFor(asset, urlStringify);
    assert(urlStringifyTemplate.from?.taintScope === "contained-values", "URLSearchParams.toString must consume contained slot values");

    const formGet = findBinding(asset, "FormData:member=method%3Ainstance%3Aget");
    const formGetTemplate = templateFor(asset, formGet);
    assert(endpointKey(formGetTemplate.from) === "receiver", "FormData.get must read receiver form-data-field slot");
    assert(formGetTemplate.from?.slotKind === "form-data-field", "FormData.get must read form-data-field slot");
    assert(endpointKey(formGetTemplate.to) === "return", "FormData.get must transfer to return");

    const formValues = findBinding(asset, "FormData:member=method%3Ainstance%3Avalues");
    const formValuesTemplate = templateFor(asset, formValues);
    assert(formValuesTemplate.from?.taintScope === "contained-values", "FormData.values must consume contained slot values");

    const resultGet = findBinding(asset, "relationalStore.ResultSet:member=method%3Ainstance%3AgetString");
    const resultGetTemplate = templateFor(asset, resultGet);
    assert(endpointKey(resultGetTemplate.from) === "receiver", "ResultSet.getString must read receiver slot");
    assert(resultGetTemplate.from?.slotKind === "rdb-column", "ResultSet.getString must read rdb-column slot");
    assert(endpointKey(resultGetTemplate.to) === "return", "ResultSet.getString must transfer to return");

    const headersAppend = findBinding(asset, "Headers:member=method%3Ainstance%3Aappend");
    const headersAppendTemplate = templateFor(asset, headersAppend);
    assert(headersAppendTemplate.to?.slotWriteMode === "append", "Headers.append must declare append slot write mode");

    const headersValues = findBinding(asset, "Headers:member=method%3Ainstance%3Avalues");
    const headersValuesTemplate = templateFor(asset, headersValues);
    assert(headersValuesTemplate.from?.taintScope === "contained-values", "Headers.values must consume contained slot values");

    const crypto = findBinding(asset, "cryptoFramework.Md:member=method%3Ainstance%3Aupdate");
    const cryptoTemplate = templateFor(asset, crypto);
    assert(endpointKey(cryptoTemplate.from) === "arg0", "Md.update must transfer data arg0");
    assert(endpointKey(cryptoTemplate.to) === "receiver", "Md.update Promise<void> must transfer into receiver state");

    console.log(`PASS test_official_structured_transfer_assets bindings=${asset.bindings.length}`);
}

main();
