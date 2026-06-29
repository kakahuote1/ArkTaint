import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { collectSourceRuleSeeds } from "../../core/kernel/rules/SourceRuleSeedCollector";
import type { AssetEndpoint } from "../../core/assets/schema";
import type { SemanticEffectSite } from "../../core/api/effects/SemanticEffectSite";
import type { ApiEffectIdentity } from "../../core/api/ApiOccurrenceIdentity";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

class FakePagNode {
    constructor(private readonly id: number, private readonly value: any, private readonly pointsTo: number[] = []) {}

    getID(): number {
        return this.id;
    }

    getValue(): any {
        return this.value;
    }

    getPointTo(): number[] {
        return this.pointsTo;
    }
}

class FakePag {
    private readonly valueToId = new Map<any, number>();
    private readonly nodes = new Map<number, FakePagNode>();

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
}

interface FakeMethodBundle {
    method: any;
    cfg: any;
}

function fakeMethod(signature: string, locals: Map<string, Local>): FakeMethodBundle {
    let method: any;
    const cfg = {
        getStmts: () => [],
        getDeclaringMethod: () => method,
    };
    method = {
        getName: () => "main",
        getSignature: () => ({ toString: () => signature }),
        getCfg: () => cfg,
        getBody: () => ({
            getLocals: () => locals,
        }),
    };
    return { method, cfg };
}

function fakeStmt(cfg: any, text: string = "source.endpoint.gate()"): any {
    return {
        getCfg: () => cfg,
        toString: () => text,
        getOriginPositionInfo: () => ({
            getLineNo: () => 7,
        }),
    };
}

function fakeInvoke(args: any[]): any {
    return {
        getArgs: () => args,
        getSpreadFlags: () => args.map(() => false),
    };
}

function apiEffectIdentity(): ApiEffectIdentity {
    return {
        canonicalApiId: "api:official:test:c2.source",
        assetId: "asset.c2.source",
        surfaceId: "surface.c2.source",
        bindingId: "binding.c2.source",
        effectTemplateId: "template.c2.source",
        role: "source",
    };
}

function sourceRule(id: string, sourceKind: string): any {
    return {
        id,
        enabled: true,
        sourceKind,
        target: "arg0",
        match: {
            kind: "canonical_api_id_equals",
            value: "api:official:test:c2.source",
        },
        apiEffect: apiEffectIdentity(),
    };
}

function semanticSite(endpointSpec: AssetEndpoint, effectSiteId: string): SemanticEffectSite {
    return {
        effectSiteId,
        occurrenceId: `${effectSiteId}:occurrence`,
        rawOccurrenceId: `${effectSiteId}:raw`,
        canonicalApiId: "api:official:test:c2.source",
        capability: "source",
        effectAssetId: "asset.c2.source",
        surfaceId: "surface.c2.source",
        bindingId: "binding.c2.source",
        effectTemplateId: "template.c2.source",
        endpointSpec,
        endpointBindingRef: "value",
    };
}

function effectSite(method: any, stmt: any, invokeExpr: any, endpointSpec: AssetEndpoint, effectSiteId: string): any {
    return {
        method,
        stmt,
        invokeExpr,
        fieldRef: undefined,
        calleeSignature: "source.endpoint.gate()",
        memberName: "gate",
        argCount: invokeExpr?.getArgs?.()?.length || 0,
        rawOccurrence: {
            rawOccurrenceId: `${effectSiteId}:raw`,
            ir: {
                memberName: "gate",
            },
            sourceLocation: {
                line: 7,
            },
        },
        resolvedOccurrence: {
            canonicalApiId: "api:official:test:c2.source",
            status: "accepted",
        },
        effect: {
            effectInstanceId: `${effectSiteId}:instance`,
            occurrenceId: `${effectSiteId}:occurrence`,
            rawOccurrenceId: `${effectSiteId}:raw`,
            identity: apiEffectIdentity(),
            endpointBindings: [
                {
                    valueRef: "value",
                    status: "exact",
                    endpoint: endpointSpec,
                },
            ],
            guardStatus: "accepted",
            endpointStatus: "exact",
            acceptedForPropagation: true,
            diagnostics: [],
        },
        semanticEffectSites: [semanticSite(endpointSpec, effectSiteId)],
    };
}

function runtimeIndex(sites: any[]): any {
    return {
        getSitesForRule(_rule: any, role?: string): any[] {
            return role === "source" || !role ? sites : [];
        },
    };
}

function collectForSite(rule: any, pag: FakePag, method: any, site: any): ReturnType<typeof collectSourceRuleSeeds> {
    return collectSourceRuleSeeds({
        scene: {
            getMethods: () => [method],
        } as any,
        pag: pag as any,
        sourceRules: [rule],
        emptyContextId: 0,
        apiEffectRuntimeIndex: runtimeIndex([site]),
    });
}

function main(): void {
    const detachedArg = new Local("detachedArg");
    const canonicalDetachedArg = new Local("detachedArg");
    const locals = new Map<string, Local>([["detachedArg", canonicalDetachedArg]]);
    const { method, cfg } = fakeMethod("@c2/source/SourceEndpointGate.main()", locals);
    const stmt = fakeStmt(cfg);
    const pag = new FakePag();
    pag.add(canonicalDetachedArg, 23);

    const resolvedEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 } };
    const resolved = collectForSite(
        sourceRule("source.c2.resolved_canonical_arg", "call_arg"),
        pag,
        method,
        effectSite(method, stmt, fakeInvoke([detachedArg]), resolvedEndpoint, "effect.c2.resolved"),
    );
    assert(resolved.facts.length === 1, `resolved source endpoint should seed exactly once, got ${resolved.facts.length}`);
    assert(resolved.facts[0].node.getID() === 23, "source seed must use the common projector's exact resolved node");
    assert(resolved.endpointResolutionAudit[0].status === "resolved", "resolved source endpoint should be recorded as resolved");
    assert(resolved.endpointResolutionAudit[0].consumerStatus === "consumable", "resolved source endpoint should be consumable");

    const unassignedReturn: AssetEndpoint = { base: { kind: "return" } };
    const noRuntime = collectForSite(
        sourceRule("source.c2.no_runtime_return", "call_return"),
        pag,
        method,
        effectSite(method, stmt, fakeInvoke([]), unassignedReturn, "effect.c2.no_runtime"),
    );
    assert(noRuntime.facts.length === 0, "no-runtime source endpoint must not seed");
    assert(noRuntime.endpointResolutionAudit[0].status === "no_runtime_endpoint", "no-runtime source endpoint should be audited");
    assert(noRuntime.endpointResolutionAudit[0].reason === "return_requires_assignment", "no-runtime reason should be exact");
    assert(noRuntime.endpointResolutionAudit[0].consumerStatus === "blocked", "no-runtime endpoint should be blocked");

    const invalidEndpoint: AssetEndpoint = { base: { kind: "arg", index: -1 } as any };
    const assetError = collectForSite(
        sourceRule("source.c2.asset_error", "call_arg"),
        pag,
        method,
        effectSite(method, stmt, fakeInvoke([detachedArg]), invalidEndpoint, "effect.c2.asset_error"),
    );
    assert(assetError.facts.length === 0, "asset endpoint errors must not seed");
    assert(assetError.endpointResolutionAudit[0].status === "asset_endpoint_error", "asset endpoint error should be audited");
    assert(assetError.endpointResolutionAudit[0].consumerStatus === "blocked", "asset endpoint error should be blocked");

    console.log("PASS test_c2_source_endpoint_gate");
}

main();
