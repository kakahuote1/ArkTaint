import * as assert from "assert";
import {
    FIELD_TRACE_GATES,
    FieldAccessIndex,
    MAX_FIELD_PATH_SEGMENTS,
    canStronglyUpdateField,
    decideFieldPrecision,
    fieldCleanEffect,
    fieldCurrentnessEffectKind,
    fieldFactKey,
    fieldLocationKey,
    fieldLocationToStateCell,
    fieldPathEquals,
    fieldPathKey,
    fieldPathStartsWith,
    makeObjectFieldFact,
    makeFieldLocation,
    projectFieldEndpoint,
    normalizeFieldPath,
    normalizeFieldPathSegments,
    toStaticFieldCell,
} from "../../core/kernel/field";
import { TaintTracker } from "../../core/kernel/model/TaintTracker";
import { StateEffectBuilder } from "../../core/kernel/oclfs/StateEffectCanonicalizer";

function testFieldPathNormalization(): void {
    assert.deepStrictEqual(
        normalizeFieldPathSegments(["", " user ", undefined, " token "]),
        ["user", "token"],
    );

    const longPath = Array.from({ length: MAX_FIELD_PATH_SEGMENTS + 5 }, (_, i) => `f${i}`);
    assert.deepStrictEqual(
        normalizeFieldPathSegments(longPath),
        longPath.slice(0, MAX_FIELD_PATH_SEGMENTS),
    );

    const normalized = normalizeFieldPath(longPath);
    assert.ok(normalized);
    assert.strictEqual(normalized!.precision, "exact");
    assert.strictEqual(normalized!.truncated, true);
}

function testContainerWindowCollapse(): void {
    const path = normalizeFieldPathSegments([
        "messages",
        "$c$:array",
        "content",
        "messages",
        "$c$:array",
        "content",
        "messages",
        "$c$:array",
        "content",
    ]);
    assert.deepStrictEqual(path, [
        "messages",
        "$c$:array",
        "content",
        "messages",
        "$c$:array",
        "content",
    ]);

    const normalized = normalizeFieldPath([
        "messages",
        "$c$:array",
        "content",
        "messages",
        "$c$:array",
        "content",
        "messages",
        "$c$:array",
        "content",
    ]);
    assert.strictEqual(normalized?.truncated, false);
}

function testFieldPathRelations(): void {
    assert.strictEqual(fieldPathKey(["config", "headers", "Authorization"]), "config.headers.Authorization");
    assert.strictEqual(fieldPathEquals(["a", "b"], ["a", "b"]), true);
    assert.strictEqual(fieldPathEquals(["a", "b"], ["a"]), false);
    assert.strictEqual(fieldPathStartsWith(["config", "headers", "Authorization"], ["config", "headers"]), true);
    assert.strictEqual(fieldPathStartsWith(["config", "headers"], ["config", "headers"]), false);
}

function testFieldLocationKey(): void {
    const location = makeFieldLocation("object-field", 42, 0, [" config ", "headers"], "exact");
    assert.strictEqual(fieldLocationKey(location), "object-field:42@0.config.headers");
    assert.deepStrictEqual(location.path?.segments, ["config", "headers"]);
}

function testFieldPrecisionPolicy(): void {
    const exact = decideFieldPrecision(["headers", "Authorization"]);
    assert.strictEqual(exact.precision, "exact");
    assert.strictEqual(exact.updateStrength, "strong");

    const unknown = decideFieldPrecision(undefined);
    assert.strictEqual(unknown.precision, "unknown");
    assert.strictEqual(unknown.updateStrength, "none");

    const truncatedPath = normalizeFieldPath(Array.from({ length: MAX_FIELD_PATH_SEGMENTS + 2 }, (_, i) => `f${i}`));
    assert.strictEqual(canStronglyUpdateField(truncatedPath), false);
}

function testFieldAccessIndex(): void {
    const raw = new Map<string, Set<number>>();
    raw.set("7-token", new Set([11, 12]));
    const index = FieldAccessIndex.fromFieldToVarIndex(raw);
    assert.deepStrictEqual([...index.getLoadTargetNodeIds(7, ["token"]) || []], [11, 12]);
    assert.strictEqual(index.getLoadTargetNodeIds(7, ["name"]), undefined);
}

function testFieldEndpointProjector(): void {
    const projected = projectFieldEndpoint({
        endpoint: "arg0",
        ownerNodeId: 3,
        contextId: 0,
        accessPath: ["headers", "Authorization"],
        owner: "Request",
    });
    assert.strictEqual(projected.status, "projected");
    assert.strictEqual(projected.location?.path?.precision, "exact");
    assert.deepStrictEqual(projected.location?.path?.segments, ["headers", "Authorization"]);

    const empty = projectFieldEndpoint({ endpoint: "arg0", ownerNodeId: 3, contextId: 0 });
    assert.strictEqual(empty.status, "not-field");
}

function testOclfsObjectFieldNormalization(): void {
    const builder = new StateEffectBuilder();
    const cell = builder.objectField("this", ["", " config ", "headers"], "scope");
    assert.deepStrictEqual(cell.fieldPath, ["config", "headers"]);
    assert.strictEqual(cell.id, "object-field|scope|this|config.headers|exact");
}

function testFieldCurrentnessBridge(): void {
    const builder = new StateEffectBuilder();
    const location = makeFieldLocation("object-field", 99, 0, ["token"], "exact");
    const cell = fieldLocationToStateCell(builder, location);
    assert.ok(cell);
    assert.strictEqual(cell!.kind, "object-field");

    const value = builder.value("v", "1", "scope");
    const clean = fieldCleanEffect(builder, cell!, "pp-clean");
    assert.strictEqual(clean.updateStrength, "strong");
    assert.strictEqual(fieldCurrentnessEffectKind(builder.store(cell!, value)), "store");
    assert.strictEqual(fieldCurrentnessEffectKind(clean), "clean");

    const staticCell = toStaticFieldCell("Config", ["token"], "scope");
    assert.strictEqual(staticCell.id, "static-field|scope|Config|token|exact");
}

function testFieldFactsAndTraceGates(): void {
    const fact = makeObjectFieldFact(8, 0, "source_rule:test", ["headers", "Authorization"]);
    assert.strictEqual(fieldFactKey(fact), "object-field:8@0.headers.Authorization|source_rule:test|");
    assert.strictEqual(FIELD_TRACE_GATES.store, "field.store");
    assert.strictEqual(FIELD_TRACE_GATES.siblingBlocked, "field.sibling.blocked");
}

function testTrackerFieldNormalization(): void {
    const tracker = new TaintTracker();
    tracker.markTainted(7, 0, "source_rule:test", ["", " config ", "headers", "Authorization"], "fact-1");

    assert.strictEqual(tracker.isTainted(7, 0, ["config", "headers", "Authorization"]), true);
    assert.strictEqual(tracker.hasSource(7, 0, "source_rule:test", ["config", "headers", "Authorization"]), true);
    assert.deepStrictEqual(tracker.getTaintFactIdsAnyContext(7, [" config ", "headers", "Authorization"]), ["fact-1"]);
    assert.strictEqual(tracker.hasDescendantFieldSourceAnyContext(7, "source_rule:test", ["config", "headers"]), true);
    assert.strictEqual(tracker.hasDescendantFieldSourceAnyContext(7, "source_rule:test", ["config", "headers", "Authorization"]), false);
}

function main(): void {
    testFieldPathNormalization();
    testContainerWindowCollapse();
    testFieldPathRelations();
    testFieldLocationKey();
    testFieldPrecisionPolicy();
    testFieldAccessIndex();
    testFieldEndpointProjector();
    testOclfsObjectFieldNormalization();
    testFieldCurrentnessBridge();
    testFieldFactsAndTraceGates();
    testTrackerFieldNormalization();
    console.log("PASS: field-sensitive core invariants");
}

main();
