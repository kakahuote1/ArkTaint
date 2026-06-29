import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ConfigBasedTransferExecutor } from "../../core/kernel/rules/ConfigBasedTransferExecutor";
import { TaintFact } from "../../core/kernel/model/TaintFact";
import type { AssetEndpoint } from "../../core/assets/schema";
import type { SemanticEffectSite } from "../../core/api/effects/SemanticEffectSite";
import type { TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

class FakePointTo implements Iterable<number> {
    constructor(private readonly ids: number[] = []) {}

    contains(id: number): boolean {
        return this.ids.includes(id);
    }

    [Symbol.iterator](): Iterator<number> {
        return this.ids[Symbol.iterator]();
    }
}

class FakePagNode {
    constructor(private readonly id: number, private readonly value: any, private readonly pointsTo: number[] = []) {}

    getID(): number {
        return this.id;
    }

    getValue(): any {
        return this.value;
    }

    getPointTo(): FakePointTo {
        return new FakePointTo(this.pointsTo);
    }
}

class FakePag {
    private readonly valueToId = new Map<any, number>();
    private readonly nodes = new Map<number, FakePagNode>();
    private nextId = 1000;

    add(value: any, id: number, pointsTo: number[] = []): void {
        this.valueToId.set(value, id);
        this.nodes.set(id, new FakePagNode(id, value, pointsTo));
        for (const objectId of pointsTo) {
            if (!this.nodes.has(objectId)) this.nodes.set(objectId, new FakePagNode(objectId, { objectId }));
        }
    }

    getNodesByValue(value: any): Map<number, number> | undefined {
        const id = this.valueToId.get(value);
        return id === undefined ? undefined : new Map([[id, id]]);
    }

    getNode(id: number): FakePagNode | undefined {
        return this.nodes.get(id);
    }

    getOrNewNode(_contextId: number, value: any): FakePagNode {
        const existing = this.valueToId.get(value);
        if (existing !== undefined) return this.nodes.get(existing)!;
        const id = this.nextId++;
        this.add(value, id);
        return this.nodes.get(id)!;
    }
}

function semanticSite(endpointSpec: AssetEndpoint, endpointBindingRef: string): SemanticEffectSite {
    return {
        effectSiteId: `effect:c2:${endpointBindingRef}:${endpointSpec.base.kind}`,
        occurrenceId: "occurrence.c2.transfer",
        rawOccurrenceId: "raw.c2.transfer",
        canonicalApiId: "api:official:test:c2.transfer",
        capability: "transfer",
        effectAssetId: "asset.c2.transfer",
        endpointSpec,
        endpointBindingRef,
    };
}

function descriptor(endpointSpec: AssetEndpoint, endpoint: string, endpointBindingRef: string = "from"): any {
    return {
        endpoint,
        semanticSite: semanticSite(endpointSpec, endpointBindingRef),
        endpointSpec,
    };
}

function descriptorWithPathFrom(
    endpointSpec: AssetEndpoint,
    endpoint: string,
    pathFromEndpointSpec: AssetEndpoint,
): any {
    const baseSite = semanticSite(endpointSpec, "from");
    return {
        endpoint,
        semanticSite: baseSite,
        endpointSpec,
        pathFrom: "arg1",
        slotKind: "map",
        pathFromSemanticSite: {
            ...baseSite,
            effectSiteId: `${baseSite.effectSiteId}:pathFrom`,
            endpointSpec: pathFromEndpointSpec,
            endpointBindingRef: "from:pathFrom",
        },
        pathFromEndpointSpec,
    };
}

function invokeSite(args: any[], baseValue?: any): any {
    const stmt = {
        toString: () => "c2.transfer.endpoint.gate()",
        getCfg: () => undefined,
    };
    return invokeSiteForStmt(stmt, args, baseValue);
}

function invokeSiteForStmt(stmt: any, args: any[], baseValue?: any): any {
    return {
        stmt,
        invokeExpr: {
            getArgs: () => args,
            getSpreadFlags: () => args.map(() => false),
        },
        signature: "c2.transfer.endpoint.gate()",
        methodName: "gate",
        calleeSignature: "c2.transfer.endpoint.gate()",
        calleeMethodName: "gate",
        invokeKind: "instance",
        args,
        baseValue,
    };
}

function exactTransferRule(): TransferRule {
    return {
        id: "transfer.c2.accepted_site.arg0_to_arg1",
        match: {
            kind: "canonical_api_id_equals",
            value: "api:official:test:c2.transfer",
        },
        from: "arg0",
        to: "arg1",
        apiEffect: {
            canonicalApiId: "api:official:test:c2.transfer",
            assetId: "asset.c2.transfer",
            surfaceId: "surface.c2.transfer",
            bindingId: "binding.c2.transfer",
            effectTemplateId: "template.c2.transfer",
            role: "transfer",
        },
    };
}

function transferEffectSite(stmt: any, acceptedForPropagation = true): any {
    const fromEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 } };
    const toEndpoint: AssetEndpoint = { base: { kind: "arg", index: 1 } };
    return {
        stmt,
        effect: {
            acceptedForPropagation,
            endpointBindings: [
                { valueRef: "from", status: "exact", endpoint: fromEndpoint },
                { valueRef: "to", status: "exact", endpoint: toEndpoint },
            ],
            identity: exactTransferRule().apiEffect,
        },
        semanticEffectSites: [
            semanticSite(fromEndpoint, "from"),
            semanticSite(toEndpoint, "to"),
        ],
    };
}

function fakeRuntimeIndex(effectSites: any[]): any {
    return {
        getSitesForRule(_rule: TransferRule, role?: string): any[] {
            return role === "transfer" || !role ? effectSites : [];
        },
        hasRuleSiteAtStmt(_rule: TransferRule, stmt: any, role?: string): boolean {
            return (role === "transfer" || !role) && effectSites.some(site =>
                site.stmt === stmt && site.effect.acceptedForPropagation,
            );
        },
    };
}

function findConsumption(stats: any, ruleId: string, blockedReason?: string): any {
    return (stats.siteConsumptions || []).find((item: any) =>
        item.ruleId === ruleId
        && (blockedReason === undefined || item.blockedReason === blockedReason)
    );
}

function main(): void {
    const executor = new ConfigBasedTransferExecutor() as any;
    const pag = new FakePag();

    const tainted = new Local("tainted");
    const target = new Local("target");
    const missingPagEndpoint = new Local("missingPagEndpoint");
    const carrier = new Local("carrier");

    pag.add(tainted, 10);
    pag.add(target, 20);
    pag.add(carrier, 30);

    const fact = new TaintFact(pag.getNode(10) as any, "source.c2", 0);

    const outOfRangeFrom = descriptor({ base: { kind: "arg", index: 1 } }, "arg1");
    assert(
        executor.endpointMatchesFact(outOfRangeFrom, invokeSite([tainted]), fact, pag as any) === false,
        "unresolved from endpoint must not match a tainted fact",
    );

    const missingPagFrom = descriptor({ base: { kind: "arg", index: 0 } }, "arg0");
    assert(
        executor.endpointMatchesFact(missingPagFrom, invokeSite([missingPagEndpoint]), fact, pag as any) === false,
        "from endpoint with no exact PAG node must not match by endpoint value alone",
    );

    const exactFrom = descriptor({ base: { kind: "arg", index: 0 } }, "arg0");
    assert(
        executor.endpointMatchesFact(exactFrom, invokeSite([tainted]), fact, pag as any) === true,
        "resolved exact from endpoint should still match the tainted fact",
    );

    const unresolvedTarget = descriptor({ base: { kind: "arg", index: 1 } }, "arg1", "to");
    const missingTargetFacts = executor.resolveTargetFacts(unresolvedTarget, invokeSite([target]), "source.c2", 0, pag as any);
    assert(missingTargetFacts.length === 0, "unresolved target endpoint must not emit target facts");

    const exactTarget = descriptor({ base: { kind: "arg", index: 0 } }, "arg0", "to");
    const targetFacts = executor.resolveTargetFacts(exactTarget, invokeSite([target]), "source.c2", 0, pag as any);
    assert(targetFacts.length === 1, "resolved exact target endpoint should emit one target fact");
    assert(targetFacts[0].node.getID() === 20, "target fact should use the exact projected PAG node");

    const pathFromMissing = descriptorWithPathFrom(
        { base: { kind: "receiver" } },
        "base",
        { base: { kind: "arg", index: 1 } },
    );
    const fieldFact = new TaintFact(pag.getNode(30) as any, "source.c2", 0, ["map:missing"]);
    assert(
        executor.endpointMatchesFact(pathFromMissing, invokeSite([], carrier), fieldFact, pag as any) === false,
        "pathFrom must be exact-projected and must not fall back to raw endpoint values",
    );
    const untrackedKey = new Local("untrackedKey");
    assert(
        executor.resolveRuntimePathKey(untrackedKey, "map", pag as any) === undefined,
        "runtime slot keys must not fall back to Local names when PAG identity is missing",
    );
    const trackedKey = new Local("trackedKey");
    pag.add(trackedKey, 50);
    assert(
        executor.resolveRuntimePathKey(trackedKey, "map", pag as any) === "node:50",
        "tracked primitive/local keys may use exact PAG node identity",
    );
    const objectKey = new Local("objectKey");
    pag.add(objectKey, 60, [600]);
    assert(
        executor.resolveRuntimePathKey(objectKey, "map", pag as any) === "object:600",
        "object keys must use exact points-to identity rather than local names",
    );

    const transferStmt = { toString: () => "accepted.transfer.site()", getCfg: () => undefined };
    const transferSite = invokeSiteForStmt(transferStmt, [tainted, target]);
    const transferRule = exactTransferRule();
    const acceptedExecutor = new ConfigBasedTransferExecutor(
        [transferRule],
        undefined,
        fakeRuntimeIndex([transferEffectSite(transferStmt)]),
    ) as any;
    acceptedExecutor.invokeSiteByStmt.set(transferStmt, transferSite);
    const transferExec = acceptedExecutor.executeFromTaintedFactWithStats(fact, pag as any);
    assert(transferExec.stats.invokeSiteCount === 1, "accepted transfer sites must be scheduled before fact endpoint matching");
    assert(transferExec.stats.endpointMatchCount === 1, "tainted fact should match the accepted transfer from endpoint");
    assert(transferExec.results.length === 1, "accepted transfer site should emit one target fact");
    assert(transferExec.results[0].fact.node.getID() === 20, "transfer target should be projected from the accepted to endpoint");
    const acceptedConsumption = findConsumption(transferExec.stats, transferRule.id);
    assert(acceptedConsumption, "accepted transfer site should write a site-level consumption record");
    assert(acceptedConsumption.scheduled === true, "accepted consumption must be scheduled");
    assert(acceptedConsumption.fromMatched === true, "accepted consumption must record fromMatched");
    assert(acceptedConsumption.toProjected === true, "accepted consumption must record toProjected");
    assert(!acceptedConsumption.blockedReason, "accepted consumption must not carry a blockedReason");
    assert(acceptedConsumption.fromEndpoint.status === "resolved", "from endpoint status should be resolved");
    assert(acceptedConsumption.toEndpoint.status === "resolved", "to endpoint status should be resolved");

    const clean = new Local("clean");
    pag.add(clean, 40);
    const cleanFact = new TaintFact(pag.getNode(40) as any, "source.c2", 0);
    const mismatchExec = acceptedExecutor.executeFromTaintedFactWithStats(cleanFact, pag as any);
    assert(mismatchExec.stats.invokeSiteCount === 1, "current fact must not be used to discover transfer callsites");
    assert(mismatchExec.stats.endpointMatchCount === 0, "non-matching fact must fail only at from endpoint matching");
    assert(mismatchExec.results.length === 0, "non-matching fact must not emit transfer facts");
    const mismatchConsumption = findConsumption(mismatchExec.stats, transferRule.id, "from_endpoint_not_matched");
    assert(mismatchConsumption, "from mismatch should write blocked site-level reason");
    assert(mismatchConsumption.scheduled === true, "from mismatch still proves accepted site scheduling");
    assert(mismatchConsumption.fromMatched === false, "from mismatch must record fromMatched=false");
    assert(mismatchConsumption.toProjected === false, "from mismatch must not project to endpoint");

    const missingToStmt = { toString: () => "accepted.transfer.site.missing.to()", getCfg: () => undefined };
    const missingToSite = invokeSiteForStmt(missingToStmt, [tainted, missingPagEndpoint]);
    const missingToExecutor = new ConfigBasedTransferExecutor(
        [transferRule],
        undefined,
        fakeRuntimeIndex([transferEffectSite(missingToStmt)]),
    ) as any;
    missingToExecutor.invokeSiteByStmt.set(missingToStmt, missingToSite);
    const missingToExec = missingToExecutor.executeFromTaintedFactWithStats(fact, pag as any);
    assert(missingToExec.stats.invokeSiteCount === 1, "accepted site with unresolved to endpoint should still be scheduled");
    assert(missingToExec.stats.endpointMatchCount === 1, "unresolved to endpoint should not erase the matched from endpoint");
    assert(missingToExec.results.length === 0, "unresolved to endpoint must not emit target facts");
    const missingToConsumption = findConsumption(missingToExec.stats, transferRule.id, "to_endpoint_unresolved");
    assert(missingToConsumption, "unresolved to endpoint should write blocked site-level reason");
    assert(missingToConsumption.scheduled === true, "unresolved to endpoint must be a scheduled accepted site");
    assert(missingToConsumption.fromMatched === true, "unresolved to endpoint must preserve fromMatched=true");
    assert(missingToConsumption.toProjected === false, "unresolved to endpoint must record toProjected=false");
    assert(missingToConsumption.toEndpoint.status !== "resolved", "unresolved to endpoint status must not be resolved");

    assert(
        acceptedExecutor.isPathDerivedSlotCurrentForWriteHistory([
            { slotWriteMode: "replace", sourceStatus: "tainted" },
            { slotWriteMode: "replace", sourceStatus: "clean" },
        ]) === false,
        "replace writes must clear prior taint when the latest write is clean",
    );
    assert(
        acceptedExecutor.isPathDerivedSlotCurrentForWriteHistory([
            { slotWriteMode: "append", sourceStatus: "tainted" },
            { slotWriteMode: "append", sourceStatus: "clean" },
        ]) === true,
        "append writes must preserve prior taint across later clean appends",
    );
    assert(
        acceptedExecutor.isPathDerivedSlotCurrentForWriteHistory([
            { slotWriteMode: "replace", sourceStatus: "tainted" },
            { slotWriteMode: "append", sourceStatus: "clean" },
        ]) === true,
        "clean append must not clear a tainted replace-written slot",
    );
    assert(
        acceptedExecutor.isPathDerivedSlotCurrentForWriteHistory([
            { slotWriteMode: "append", sourceStatus: "tainted" },
            { slotWriteMode: "replace", sourceStatus: "clean" },
        ]) === false,
        "clean replace must clear an earlier tainted append",
    );

    const unresolvedExecutor = new ConfigBasedTransferExecutor(
        [transferRule],
        undefined,
        fakeRuntimeIndex([transferEffectSite(transferStmt, false)]),
    ) as any;
    unresolvedExecutor.invokeSiteByStmt.set(transferStmt, transferSite);
    const unresolvedExec = unresolvedExecutor.executeFromTaintedFactWithStats(fact, pag as any);
    assert(unresolvedExec.stats.invokeSiteCount === 0, "unaccepted transfer sites must not be scheduled");
    assert(unresolvedExec.results.length === 0, "unaccepted transfer sites must not emit facts");
    const noAcceptedConsumption = findConsumption(unresolvedExec.stats, transferRule.id, "no_accepted_transfer_site");
    assert(noAcceptedConsumption, "unaccepted transfer site should write no_accepted_transfer_site reason");
    assert(noAcceptedConsumption.scheduled === false, "unaccepted transfer site must not be scheduled");
    assert(noAcceptedConsumption.fromMatched === false, "unaccepted transfer site must not match from endpoint");
    assert(noAcceptedConsumption.toProjected === false, "unaccepted transfer site must not project to endpoint");

    console.log("PASS test_c2_transfer_endpoint_gate");
}

main();
