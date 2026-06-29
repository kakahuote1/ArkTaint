import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument } from "../../core/assets/schema";
import type { CanonicalApiDescriptor } from "../../core/api/identity/CanonicalApiDescriptor";
import { parseCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import { canonicalApiDescriptorFromIdSeed } from "../../core/api/identity/CanonicalApiDescriptorFromId";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function collectCanonicalApiIds(value: unknown): string[] {
    const ids = new Set<string>();
    JSON.stringify(value, (key, child) => {
        if (key === "canonicalApiId" && typeof child === "string") ids.add(child);
        return child;
    });
    return [...ids].sort((left, right) => left.localeCompare(right));
}

function officialDescriptorFor(canonicalApiId: string): CanonicalApiDescriptor | undefined {
    try {
        return canonicalApiDescriptorFromIdSeed({ canonicalApiId });
    } catch {
        return undefined;
    }
}

function assertOfficialCanonicalApiId(canonicalApiId: string, context: string): CanonicalApiDescriptor {
    const parsed = parseCanonicalApiId(canonicalApiId);
    assert(parsed, `${context} must be a parseable canonicalApiId`);
    assert(parsed.authority === "official", `${context} must be backed by official declaration authority`);
    assert(parsed.module !== "local", `${context} must not use local placeholder module`);
    assert(parsed.file !== "local" && !parsed.file.endsWith("/local.d.ts"), `${context} must not use local placeholder file`);
    assert(parsed.ret.trim().toLowerCase() !== "unknown", `${context} must not use unknown return type`);
    const descriptor = canonicalApiDescriptorFromIdSeed({ canonicalApiId });
    assert(descriptor.provenance.source === "official-declaration", `${context} must resolve as official declaration`);
    return descriptor;
}

function main(): void {
    const root = path.resolve("src/models/kernel/arkmain");
    const files = collectJsonFiles(root);
    assert(files.length >= 1, "expected built-in arkmain asset files");
    for (const file of files) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        const validation = validateAssetDocument(parsed, { canonicalApiDescriptors: officialDescriptorFor });
        assert(validation.valid, `${file} failed asset validation: ${validation.errors.join("; ")}`);
        assert(parsed.plane === "arkmain", `${file} must use plane=arkmain`);
        assert(parsed.status === "official", `${file} must be official`);
        assert(Array.isArray(parsed.surfaces) && parsed.surfaces.length > 0, `${file} must declare surfaces`);
        assert(Array.isArray(parsed.bindings) && parsed.bindings.length > 0, `${file} must declare bindings`);
        assert(Array.isArray(parsed.effectTemplates) && parsed.effectTemplates.length > 0, `${file} must declare effectTemplates`);
        assert(
            parsed.effectTemplates.every((template: any) =>
                template.kind === "entry.lifecycle"
                || template.kind === "entry.callbackRegister"
                || template.kind === "entry.scheduleUnit"
                || template.kind === "entry.frameworkInvoke",
            ),
            `${file} must use controlled arkmain entry templates`,
        );

        const surfaceIds = new Set(parsed.surfaces.map((surface: any) => surface.surfaceId));
        const templateIds = new Set(parsed.effectTemplates.map((template: any) => template.id));
        const surfaceCanonicalIds = new Set<string>();
        for (const [index, surface] of parsed.surfaces.entries()) {
            assert(surface.canonicalApiId, `${file} surface ${surface.surfaceId} must declare canonicalApiId`);
            const descriptor = assertOfficialCanonicalApiId(surface.canonicalApiId, `${file} surface[${index}]`);
            surfaceCanonicalIds.add(surface.canonicalApiId);
            if (surface.kind === "invoke" || surface.kind === "construct") {
                assert(descriptor.arkanalyzer, `${file} ${surface.surfaceId} must resolve to method evidence`);
                assert(
                    !!surface.evidence?.arkanalyzer?.methodKey,
                    `${file} ${surface.surfaceId} must carry methodKey evidence on invoke/construct surface`,
                );
            }
        }

        for (const binding of parsed.bindings) {
            assert(surfaceIds.has(binding.surfaceId), `${file} binding ${binding.bindingId} references missing surface ${binding.surfaceId}`);
            assert(binding.canonicalApiId, `${file} binding ${binding.bindingId} must declare canonicalApiId`);
            assertOfficialCanonicalApiId(binding.canonicalApiId, `${file} binding ${binding.bindingId}`);
            const surface = parsed.surfaces.find((item: any) => item.surfaceId === binding.surfaceId);
            assert(surface?.canonicalApiId === binding.canonicalApiId, `${file} binding ${binding.bindingId} canonicalApiId must match surface`);
            for (const ref of binding.effectTemplateRefs || []) {
                assert(templateIds.has(ref), `${file} binding ${binding.bindingId} references missing template ${ref}`);
            }
        }
        for (const template of parsed.effectTemplates) {
            assert(template.ownerKind !== "unknown_owner", `${file} template ${template.id} must not use unknown_owner`);
            for (const canonicalApiId of collectCanonicalApiIds(template)) {
                assert(
                    surfaceCanonicalIds.has(canonicalApiId),
                    `${file} template ${template.id} references canonicalApiId outside declared surfaces`,
                );
            }
        }

        const serialized = JSON.stringify(parsed);
        for (const forbidden of [
            "api:internal",
            "ret=unknown",
            "%unk",
            "@unk",
            "unknown_owner",
            "schemaVersion",
            "coverageSurfaces",
            "semanticsRef",
            "semantics.effects",
            "\"selector\"",
            "\"tier\"",
            "\"version\"",
            "\"modelVersion\"",
            "\"assetVersion\"",
            "\"overrideContracts\"",
            "\"declarationContracts\"",
        ]) {
            assert(!serialized.includes(forbidden), `${file} contains forbidden pseudo/legacy marker ${forbidden}`);
        }
    }
    console.log(`PASS test_arkmain_assets_v2_schema files=${files.length}`);
}

function collectJsonFiles(root: string): string[] {
    const out: string[] = [];
    const queue = [root];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".json")) {
                out.push(fullPath);
            }
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

main();
