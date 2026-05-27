import { TaintFact } from "../../core/kernel/model/TaintFact";
import { createHandoffPropagationSession } from "../../core/kernel/semantic_handoff/SemanticHandoffPropagation";
import { createExactHandoffHandle, createHandoffHandle } from "../../core/kernel/semantic_handoff/SemanticHandoffTypes";

function makeNode(id: number): any {
    return {
        getID: () => id,
        getValue: () => ({ id }),
    };
}

const nodes = new Map<number, any>([
    [1, makeNode(1)],
    [2, makeNode(2)],
    [3, makeNode(3)],
    [4, makeNode(4)],
    [5, makeNode(5)],
    [6, makeNode(6)],
]);

function makeEvent(nodeId: number, field?: string[]): any {
    const sourceFact = new TaintFact(nodes.get(nodeId), "source.test", 0, field);
    const collectorItems: any[] = [];
    const buildEmission = (targetNodeId: number, reason: string, nextField?: string[]) => ({
        reason,
        fact: new TaintFact(nodes.get(targetNodeId), sourceFact.source, sourceFact.contextID, nextField),
    });
    const emit = {
        preserveToNode(targetNodeId: number, reason: string) {
            return [buildEmission(targetNodeId, reason, field)];
        },
        toNode(targetNodeId: number, reason: string) {
            return [buildEmission(targetNodeId, reason)];
        },
        toField(targetNodeId: number, fieldPath: string[], reason: string) {
            return [buildEmission(targetNodeId, reason, fieldPath)];
        },
        collector() {
            return {
                push(items?: any[] | void): void {
                    if (!items) return;
                    collectorItems.push(...items);
                },
                size(): number {
                    return collectorItems.length;
                },
                done(): any[] | undefined {
                    return collectorItems.length > 0 ? [...collectorItems] : undefined;
                },
            };
        },
    };
    return {
        current: {
            nodeId,
            source: sourceFact.source,
            contextId: sourceFact.contextID,
            field,
            fieldHead: () => field?.[0],
            fieldTail: () => field && field.length > 1 ? field.slice(1) : undefined,
            cloneField: () => field ? [...field] : undefined,
        },
        emit,
    };
}

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const token = createExactHandoffHandle("keyed-semantic-slot", "test.storage", "token");
    const other = createExactHandoffHandle("keyed-semantic-slot", "test.storage", "other");
    const session = createHandoffPropagationSession([
        {
            kind: "put",
            handle: token,
            source: { nodeId: 1 },
            reason: "put-token",
        },
        {
            kind: "get",
            handle: token,
            target: { nodeId: 2 },
            reason: "get-token",
        },
        {
            kind: "get",
            handle: other,
            target: { nodeId: 4 },
            reason: "get-other",
        },
    ]);

    const first = session.emitForFact(makeEvent(1));
    assert(first?.length === 1, `expected one exact-handle emission, got ${first?.length || 0}`);
    assert(first![0].fact.id === "2@0", `expected target fact 2@0, got ${first![0].fact.id}`);
    assert(first![0].reason === "get-token", `expected get-token reason, got ${first![0].reason}`);

    const repeated = session.emitForFact(makeEvent(1));
    assert(!repeated || repeated.length === 0, "expected repeated same-state handoff to be deduplicated");

    const fieldSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: token,
            source: { nodeId: 3, fieldHead: "tokenField" },
            reason: "put-token-field",
        },
        {
            kind: "get",
            handle: token,
            target: { nodeId: 4, fieldPath: ["value"] },
            reason: "get-token-field",
        },
        {
            kind: "get",
            handle: token,
            target: { nodeId: 3, fieldPath: ["tokenField"] },
            reason: "self-echo",
        },
    ]);

    const fieldResult = fieldSession.emitForFact(makeEvent(3, ["tokenField"]));
    assert(fieldResult?.length === 1, `expected one field handoff emission, got ${fieldResult?.length || 0}`);
    assert(fieldResult![0].fact.id === "4@0.value", `expected target field fact 4@0.value, got ${fieldResult![0].fact.id}`);
    assert(fieldResult![0].reason === "get-token-field", `expected self echo to be skipped, got ${fieldResult![0].reason}`);

    const projectedFieldSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: token,
            source: { nodeId: 3, fieldPathPrefix: ["payload", "id"] },
            reason: "put-token-projected-field",
        },
        {
            kind: "get",
            handle: token,
            target: {
                nodeId: 4,
                currentField: {
                    mode: "prefix",
                    prefix: ["observed"],
                    stripPrefixes: [["payload", "id"]],
                    requireField: true,
                },
            },
            reason: "get-token-projected-field",
        },
    ]);
    const projectedField = projectedFieldSession.emitForFact(makeEvent(3, ["payload", "id", "value"]));
    assert(projectedField?.length === 1, `expected one projected field handoff emission, got ${projectedField?.length || 0}`);
    assert(projectedField![0].fact.id === "4@0.observed.value", `expected stripped/prefixed target field, got ${projectedField![0].fact.id}`);
    const mismatchedProjectedField = projectedFieldSession.emitForFact(makeEvent(3, ["payload", "name"]));
    assert(!mismatchedProjectedField || mismatchedProjectedField.length === 0, "expected source fieldPathPrefix mismatch to be skipped");

    const parent = createExactHandoffHandle("reactive-state-slot", "test.state", "parent.uid");
    const child = createExactHandoffHandle("reactive-state-slot", "test.state", "child.uid");
    const linkedSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: parent,
            source: { nodeId: 1, fieldHead: "uid" },
            reason: "put-parent-uid",
        },
        {
            kind: "scoped-link",
            left: parent,
            right: child,
            reason: "link-parent-child",
        },
        {
            kind: "get",
            handle: child,
            target: { nodeId: 2, currentField: { mode: "tail", requireField: true } },
            reason: "get-child-uid-load",
        },
    ]);

    const linked = linkedSession.emitForFact(makeEvent(1, ["uid", "value"]));
    assert(linked?.length === 1, `expected scoped-link emission, got ${linked?.length || 0}`);
    assert(linked![0].fact.id === "2@0.value", `expected tail field on linked target, got ${linked![0].fact.id}`);

    const noFieldLinked = createHandoffPropagationSession([
        {
            kind: "put",
            handle: parent,
            source: { nodeId: 1 },
            reason: "put-parent",
        },
        {
            kind: "scoped-link",
            left: parent,
            right: child,
            reason: "link-parent-child",
        },
        {
            kind: "get",
            handle: child,
            target: { nodeId: 2, currentField: { mode: "tail", requireField: true } },
            reason: "get-child-requires-field",
        },
    ]).emitForFact(makeEvent(1));
    assert(!noFieldLinked || noFieldLinked.length === 0, "expected requireField current-field target to be skipped without field context");

    const killedSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: token,
            source: { nodeId: 1 },
            reason: "put-before-kill",
            flowScope: "same-method",
            sequence: 1,
        },
        {
            kind: "kill",
            handle: token,
            reason: "definite-kill",
            flowScope: "same-method",
            sequence: 2,
            updateStrength: "strong",
        },
        {
            kind: "get",
            handle: token,
            target: { nodeId: 2 },
            reason: "get-after-kill",
            flowScope: "same-method",
            sequence: 3,
        },
    ]).emitForFact(makeEvent(1));
    assert(!killedSession || killedSession.length === 0, "expected exact strong kill between put/get to suppress stale handoff");

    const weakKillSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: token,
            source: { nodeId: 1 },
            reason: "put-before-weak-kill",
            flowScope: "same-method",
            sequence: 1,
        },
        {
            kind: "kill",
            handle: token,
            reason: "weak-kill",
            flowScope: "same-method",
            sequence: 2,
            updateStrength: "weak",
        },
        {
            kind: "get",
            handle: token,
            target: { nodeId: 2 },
            reason: "get-after-weak-kill",
            flowScope: "same-method",
            sequence: 3,
        },
    ]).emitForFact(makeEvent(1));
    assert(weakKillSession?.length === 1, `expected weak kill not to suppress may-flow, got ${weakKillSession?.length || 0}`);

    const reversedSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: token,
            source: { nodeId: 1 },
            reason: "put-after-get",
            flowScope: "same-method",
            sequence: 3,
        },
        {
            kind: "get",
            handle: token,
            target: { nodeId: 2 },
            reason: "get-before-put",
            flowScope: "same-method",
            sequence: 1,
        },
    ]).emitForFact(makeEvent(1));
    assert(!reversedSession || reversedSession.length === 0, "expected same-scope get-before-put to be skipped");

    const partialToken = createHandoffHandle("keyed-semantic-slot", "test.storage", "token-like", { precision: "partial" });
    const unknownToken = createHandoffHandle("keyed-semantic-slot", "test.storage", "runtime-key", { precision: "unknown" });
    const mayConservative = createHandoffPropagationSession([
        {
            kind: "put",
            handle: partialToken,
            source: { nodeId: 5 },
            reason: "put-partial",
        },
        {
            kind: "get",
            handle: unknownToken,
            target: { nodeId: 6 },
            reason: "get-unknown",
        },
    ]).emitForFact(makeEvent(5));
    assert(mayConservative?.length === 1, `expected conservative may-compatible handoff, got ${mayConservative?.length || 0}`);

    const mayBlocked = createHandoffPropagationSession([
        {
            kind: "put",
            handle: partialToken,
            source: { nodeId: 5 },
            reason: "put-partial",
        },
        {
            kind: "get",
            handle: unknownToken,
            target: { nodeId: 6 },
            reason: "get-unknown",
        },
    ], { mayCompatibilityPolicy: "block" }).emitForFact(makeEvent(5));
    assert(!mayBlocked || mayBlocked.length === 0, "expected block policy to suppress may-compatible handoff");

    const nonCanonicalEventName = createExactHandoffHandle("keyed-semantic-slot", "project.eventualCache", "token");
    const familyAliasSession = createHandoffPropagationSession([
        {
            kind: "put",
            handle: nonCanonicalEventName,
            source: { nodeId: 1 },
            reason: "put-eventual-cache",
        },
        {
            kind: "get",
            handle: nonCanonicalEventName,
            target: { nodeId: 2 },
            reason: "get-eventual-cache",
        },
    ]).emitForFact(makeEvent(1));
    assert(familyAliasSession?.length === 1, `expected non-canonical family emission, got ${familyAliasSession?.length || 0}`);
    const aliasCertificate = familyAliasSession![0].currentnessCertificates?.[0];
    assert(
        aliasCertificate?.candidateFlow.producerCell.kind === "keyed-semantic-slot",
        "family names must not override explicit cellKind or trigger substring/fuzzy event matching",
    );

    console.log("PASS test_handoff_sensitive_propagation");
}

main().catch(err => {
    console.error("FAIL test_handoff_sensitive_propagation");
    console.error(err);
    process.exitCode = 1;
});
