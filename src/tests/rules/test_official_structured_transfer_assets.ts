import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(): AssetDocumentBase {
    const file = path.resolve("src/models/kernel/rules/transfers/official_structured.rules.json");
    return JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
}

function byId(rules: TransferRule[]): Map<string, TransferRule> {
    return new Map(rules.map(rule => [rule.id, rule]));
}

function main(): void {
    const asset = loadAsset();
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `official structured transfer asset must validate: ${validation.errors.join("; ")}`);
    assert(asset.status === "official", "official structured transfer asset must be official");
    assert(asset.plane === "rule", "official structured transfer asset must be a rule asset");

    const lowered = lowerRuleAssetsToRuleSet([asset]);
    assert(lowered.diagnostics.length === 0, `lowering diagnostics should be empty: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.transfers.length >= 40, `expected broad official transfer coverage, got ${lowered.ruleSet.transfers.length}`);

    const ids = lowered.ruleSet.transfers.map(rule => rule.id);
    assert(new Set(ids).size === ids.length, "official structured transfers must lower to unique runtime rule ids");
    assert(!ids.some(id => id.includes("verify")), "crypto verify must not be modeled as value-preserving transfer");

    const transfers = byId(lowered.ruleSet.transfers);
    const urlSet = transfers.get("transfer.official.urlsearchparams.set");
    assert(urlSet?.from === "arg1", "URLSearchParams.set must transfer value arg1");
    assert(typeof urlSet.to === "object" && urlSet.to.endpoint === "base", "URLSearchParams.set must write into receiver slot");
    assert(typeof urlSet.to === "object" && urlSet.to.pathFrom === "arg0", "URLSearchParams.set slot key must come from arg0");
    assert(typeof urlSet.to === "object" && urlSet.to.slotKind === "url-search-param", "URLSearchParams.set must use url-search-param slot");

    const formGet = transfers.get("transfer.official.formdata.get");
    assert(typeof formGet?.from === "object" && formGet.from.endpoint === "base", "FormData.get must read receiver slot");
    assert(typeof formGet?.from === "object" && formGet.from.pathFrom === "arg0", "FormData.get slot key must come from arg0");
    assert(formGet?.to === "result", "FormData.get must transfer to result");

    const resultGet = transfers.get("transfer.official.resultset.getString");
    assert(typeof resultGet?.from === "object" && resultGet.from.slotKind === "rdb-column", "ResultSet.getString must read rdb-column slot");
    assert(resultGet?.to === "result", "ResultSet.getString must transfer to result");

    const between = lowered.ruleSet.transfers.filter(rule => rule.id.startsWith("transfer.official.rdbpredicates.between."));
    assert(between.length === 2, "RdbPredicates.between must emit transfers for both bounds");
    assert(new Set(between.map(rule => rule.from)).has("arg1"), "RdbPredicates.between must transfer lower bound");
    assert(new Set(between.map(rule => rule.from)).has("arg2"), "RdbPredicates.between must transfer upper bound");

    const crypto = transfers.get("transfer.official.crypto.cipher.doFinal");
    assert(crypto?.from === "arg0" && crypto.to === "result", "Cipher.doFinal must transfer data arg0 to result");

    console.log(`PASS test_official_structured_transfer_assets transfers=${lowered.ruleSet.transfers.length}`);
}

main();
