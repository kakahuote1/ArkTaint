import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(): AssetDocumentBase {
    const file = path.resolve("src/models/kernel/rules/transfers/string.rules.json");
    return JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
}

function bindingByTemplate(asset: AssetDocumentBase, templateId: string): AssetDocumentBase["bindings"][number] {
    const binding = asset.bindings.find(item => item.effectTemplateRefs.includes(templateId));
    assert(binding, `missing binding for ${templateId}`);
    return binding;
}

function template(asset: AssetDocumentBase, templateId: string): any {
    const item = asset.effectTemplates.find(t => t.id === templateId);
    assert(item, `missing template ${templateId}`);
    return item;
}

function main(): void {
    const asset = loadAsset();
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `official string transfer asset must validate: ${validation.errors.join("; ")}`);

    const concatArgs = template(asset, "template:asset.rule.kernel.transfers.string:0002");
    assert(concatArgs.from?.base?.kind === "rest", "String.concat argument transfer must use a rest endpoint");
    assert(concatArgs.from?.base?.startIndex === 0, "String.concat rest endpoint must start at argument 0");

    const replaceReplacer = bindingByTemplate(asset, "template:asset.rule.kernel.transfers.string:0027");
    assert(replaceReplacer.metadata?.enabled === false, "String.replace function replacer object transfer must be disabled");
    const replaceAllReplacer = bindingByTemplate(asset, "template:asset.rule.kernel.transfers.string:0031");
    assert(replaceAllReplacer.metadata?.enabled === false, "String.replaceAll function replacer object transfer must be disabled");

    const rawTemplate = template(asset, "template:asset.rule.kernel.transfers.string:0039");
    assert(rawTemplate.from?.base?.kind === "arg", "String.raw template transfer must come from arg0");
    assert(rawTemplate.from?.base?.index === 0, "String.raw template transfer must come from arg0");
    assert(rawTemplate.from?.accessPath?.join(".") === "raw", "String.raw template transfer must read arg0.raw");

    const rawSubstitutions = template(asset, "template:asset.rule.kernel.transfers.string:0040");
    assert(rawSubstitutions.from?.base?.kind === "rest", "String.raw substitutions transfer must use rest endpoint");
    assert(rawSubstitutions.from?.base?.startIndex === 1, "String.raw substitutions rest endpoint must start at argument 1");

    console.log(`PASS test_official_string_transfer_assets bindings=${asset.bindings.length}`);
}

main();
