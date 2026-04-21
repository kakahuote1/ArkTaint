import * as fs from "fs";
import * as path from "path";

interface ArkMainFrameworkCatalogDocument {
    schemaVersion: number;
    reactiveAnchorMethodNames: string[];
    abilityBaseClassNames: string[];
    abilityHandoffTargetMethodNames: string[];
    pageMethodNames: string[];
    routerOwnerClassNames: string[];
    navigationSourceOwnerClassNames: string[];
    routerSourceMethodNames: string[];
    routerTriggerMethodNames: string[];
    watchLikeDecorators: string[];
    ownerDecorators: string[];
    builderDecorator: string;
    deferredContinuationMethodNames: string[];
    openWorldCallbackEntryFamilies: string[];
}

const catalog = loadFrameworkCatalog();

export const ARK_MAIN_REACTIVE_ANCHOR_METHOD_NAMES = catalog.reactiveAnchorMethodNames;
export const ARK_MAIN_ABILITY_BASE_CLASS_NAMES = new Set(catalog.abilityBaseClassNames);
export const ARK_MAIN_ABILITY_HANDOFF_TARGET_METHOD_NAMES = new Set(catalog.abilityHandoffTargetMethodNames);
export const ARK_MAIN_PAGE_METHOD_NAMES = new Set(catalog.pageMethodNames);
export const ARK_MAIN_ROUTER_OWNER_CLASS_NAMES = new Set(catalog.routerOwnerClassNames);
export const ARK_MAIN_NAVIGATION_SOURCE_OWNER_CLASS_NAMES = new Set(catalog.navigationSourceOwnerClassNames);
export const ARK_MAIN_ROUTER_SOURCE_METHOD_NAMES = new Set(catalog.routerSourceMethodNames);
export const ARK_MAIN_ROUTER_TRIGGER_METHOD_NAMES = new Set(catalog.routerTriggerMethodNames);
export const ARK_MAIN_WATCH_LIKE_DECORATORS = new Set(catalog.watchLikeDecorators);
export const ARK_MAIN_OWNER_DECORATORS = new Set(catalog.ownerDecorators);
export const ARK_MAIN_BUILDER_DECORATOR = catalog.builderDecorator;
export const ARK_MAIN_DEFERRED_CONTINUATION_METHOD_NAMES = new Set(catalog.deferredContinuationMethodNames);
export const ARK_MAIN_OPEN_WORLD_CALLBACK_ENTRY_FAMILIES = new Set(catalog.openWorldCallbackEntryFamilies);

function loadFrameworkCatalog(): ArkMainFrameworkCatalogDocument {
    const catalogPath = resolveFrameworkCatalogPath();
    if (!fs.existsSync(catalogPath) || !fs.statSync(catalogPath).isFile()) {
        throw new Error(`arkmain framework catalog not found: ${catalogPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    return validateFrameworkCatalog(parsed, catalogPath);
}

function resolveFrameworkCatalogPath(): string {
    const candidates = [
        path.resolve(__dirname, "../../../../../src/models/kernel/arkmain/harmony/framework.catalog.json"),
        path.resolve(process.cwd(), "src/models/kernel/arkmain/harmony/framework.catalog.json"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return candidates[0];
}

function validateFrameworkCatalog(value: unknown, catalogPath: string): ArkMainFrameworkCatalogDocument {
    const doc = expectRecord(value, catalogPath);
    return {
        schemaVersion: expectPositiveInteger(doc.schemaVersion, `${catalogPath}.schemaVersion`),
        reactiveAnchorMethodNames: expectStringArray(doc.reactiveAnchorMethodNames, `${catalogPath}.reactiveAnchorMethodNames`),
        abilityBaseClassNames: expectStringArray(doc.abilityBaseClassNames, `${catalogPath}.abilityBaseClassNames`),
        abilityHandoffTargetMethodNames: expectStringArray(doc.abilityHandoffTargetMethodNames, `${catalogPath}.abilityHandoffTargetMethodNames`),
        pageMethodNames: expectStringArray(doc.pageMethodNames, `${catalogPath}.pageMethodNames`),
        routerOwnerClassNames: expectStringArray(doc.routerOwnerClassNames, `${catalogPath}.routerOwnerClassNames`),
        navigationSourceOwnerClassNames: expectStringArray(doc.navigationSourceOwnerClassNames, `${catalogPath}.navigationSourceOwnerClassNames`),
        routerSourceMethodNames: expectStringArray(doc.routerSourceMethodNames, `${catalogPath}.routerSourceMethodNames`),
        routerTriggerMethodNames: expectStringArray(doc.routerTriggerMethodNames, `${catalogPath}.routerTriggerMethodNames`),
        watchLikeDecorators: expectStringArray(doc.watchLikeDecorators, `${catalogPath}.watchLikeDecorators`),
        ownerDecorators: expectStringArray(doc.ownerDecorators, `${catalogPath}.ownerDecorators`),
        builderDecorator: expectString(doc.builderDecorator, `${catalogPath}.builderDecorator`),
        deferredContinuationMethodNames: expectStringArray(doc.deferredContinuationMethodNames, `${catalogPath}.deferredContinuationMethodNames`),
        openWorldCallbackEntryFamilies: expectStringArray(doc.openWorldCallbackEntryFamilies, `${catalogPath}.openWorldCallbackEntryFamilies`),
    };
}

function expectRecord(value: unknown, pathText: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${pathText} must be an object`);
    }
    return value as Record<string, unknown>;
}

function expectPositiveInteger(value: unknown, pathText: string): number {
    if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new Error(`${pathText} must be a positive integer`);
    }
    return value as number;
}

function expectString(value: unknown, pathText: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${pathText} must be a non-empty string`);
    }
    return value.trim();
}

function expectStringArray(value: unknown, pathText: string): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`${pathText} must be an array`);
    }
    return value.map((item, index) => {
        if (typeof item !== "string" || item.trim().length === 0) {
            throw new Error(`${pathText}[${index}] must be a non-empty string`);
        }
        return item.trim();
    });
}
