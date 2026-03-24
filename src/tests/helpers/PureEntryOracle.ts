import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkClass } from "../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    expandPureEntryMethodsByDirectCalls,
    resolvePureEntryCallbackRegistrationsFromStmt,
    resolvePureEntryChannelCallbackRegistration,
    resolvePureEntryControllerOptionCallbackRegistrationsFromStmt,
    resolvePureEntryFrameworkCallbackRegistration,
    resolvePureEntryKnownKeyedCallbackRegistrationsFromStmt,
    resolvePureEntrySchedulerCallbackRegistration,
} from "./PureEntryStaticOracleSupport";

export type PureEntrySuiteCategory =
    | "ability_lifecycle"
    | "page_visibility"
    | "ui_event_callback"
    | "reactive_watch"
    | "reactive_binding"
    | "reactive_composition"
    | "route_handoff"
    | "cross_component_handoff"
    | "event_async"
    | "framework_probe";

export interface PureEntryOracle {
    validTargets: string[];
    broadTargets: string[];
    classification: "positive" | "negative" | "excluded";
    notes: string[];
}

const PAGE_METHOD_NAMES = new Set([
    "build",
    "aboutToAppear",
    "onPageShow",
    "onPageHide",
    "render",
]);

const REACTIVE_FIELD_DECORATOR_NAMES = new Set([
    "State",
    "Prop",
    "Link",
    "ObjectLink",
    "Provide",
    "Consume",
]);

const LIFECYCLE_METHOD_NAMES = new Set([
    "onCreate",
    "onDestroy",
    "onNewWant",
    "onConnect",
    "onDisconnect",
    "onWindowStageCreate",
    "onWindowStageDestroy",
    "onForeground",
    "onBackground",
    "onAddForm",
    "onUpdateForm",
    "onRemoveForm",
    "onFormEvent",
    "onAcquireFormState",
    "onCastToNormalForm",
    "onRestore",
    "onBackup",
    "onSessionCreate",
    "onWorkStart",
    "onWorkStop",
]);

const ABILITY_BASE_CLASS_NAMES = new Set([
    "Ability",
    "UIAbility",
    "UiExtensionAbility",
    "UIExtensionAbility",
    "FormExtensionAbility",
    "ServiceExtensionAbility",
    "BackupExtensionAbility",
    "InputMethodExtensionAbility",
    "WorkSchedulerExtensionAbility",
    "AbilityStage",
]);

const COMPONENT_ANCHOR_METHOD_NAMES = new Set([
    "build",
    "aboutToAppear",
    "onPageShow",
    "render",
]);

const COMPOSITION_METHOD_NAMES = new Set([
    "build",
    "render",
]);

const ROUTE_METHOD_NAMES = new Set([
    "pushUrl",
    "replaceUrl",
    "pushPath",
    "replacePath",
    "getParams",
    "back",
    "register",
    "setBuilder",
    "setDestinationBuilder",
    "trigger",
]);

const VALID_ROUTE_OWNER_NAMES = new Set([
    "Router",
    "NavPathStack",
    "NavDestination",
]);

const HANDOFF_SOURCE_METHOD_NAMES = new Set([
    "startAbility",
    "startAbilityForResult",
]);

const HANDOFF_RECEIVER_METHOD_NAMES = new Set([
    "onCreate",
    "onNewWant",
]);

const HANDOFF_PAYLOAD_TYPE_NAMES = new Set([
    "Want",
]);
const WATCH_LIKE_DECORATORS = new Set(["Watch", "Monitor"]);

function normalizeDecoratorKind(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    return normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
}

function extractWatchTargets(decorators: any[]): string[] {
    const out = new Set<string>();
    for (const decorator of decorators) {
        const kind = normalizeDecoratorKind(decorator?.getKind?.());
        if (!kind || !WATCH_LIKE_DECORATORS.has(kind)) continue;
        const raw = decorator?.getParam?.() || decorator?.getContent?.() || "";
        const text = String(raw || "").trim();
        if (!text) continue;
        const quoted = text.match(/^[\"'`](.+)[\"'`]$/);
        if (quoted) {
            out.add(quoted[1]);
            continue;
        }
        const contentMatch = text.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
        if (contentMatch) {
            out.add(contentMatch[1]);
            continue;
        }
        out.add(text);
    }
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function methodRef(method: ArkMethod): string {
    const cls = method.getDeclaringArkClass?.();
    const clsName = cls?.getName?.() || "%dflt";
    return `${clsName}.${method.getName()}`;
}

function addMethodRef(out: Set<string>, method: ArkMethod): void {
    out.add(methodRef(method));
}

function getSceneMethods(scene: Scene): ArkMethod[] {
    return scene.getMethods().filter(method => method.getName() !== "%dflt");
}

function getNormalizedClassName(raw: string | undefined): string {
    return (raw || "").replace(/^@/, "").trim();
}

function getNormalizedTypeName(raw: string | undefined): string {
    const normalized = String(raw || "").replace(/^@/, "").trim();
    if (!normalized) return "";
    const segments = normalized.split(":");
    return segments[segments.length - 1].trim();
}

function matchesAbilityBaseName(raw: string | undefined): boolean {
    const normalized = getNormalizedClassName(raw);
    if (!normalized) return false;
    return ABILITY_BASE_CLASS_NAMES.has(normalized);
}

function isAbilityLikeClass(cls: ArkClass): boolean {
    if (matchesAbilityBaseName(cls.getSuperClassName?.())) {
        return true;
    }

    let current = cls.getSuperClass?.();
    while (current) {
        if (matchesAbilityBaseName(current.getName?.()) || matchesAbilityBaseName(current.getSuperClassName?.())) {
            return true;
        }
        current = current.getSuperClass?.();
    }
    return false;
}

function isPageMethod(method: ArkMethod): boolean {
    return PAGE_METHOD_NAMES.has(method.getName());
}

function isLifecycleMethod(method: ArkMethod): boolean {
    return LIFECYCLE_METHOD_NAMES.has(method.getName());
}

function hasDirectLocalBuildOnlyShape(cls: ArkClass): boolean {
    const methods = cls.getMethods().filter(method => !method.isStatic());
    return methods.some(method => method.getName() === "build");
}

function isPageLikeClass(cls: ArkClass, methods: ArkMethod[]): boolean {
    const methodNames = new Set(methods.map(method => method.getName()));
    return Boolean(
        cls.hasDecorator?.("Entry")
        || cls.hasComponentDecorator?.()
        || cls.hasDecorator?.("Component")
        || methodNames.has("aboutToAppear")
        || methodNames.has("onPageShow")
        || methodNames.has("onPageHide")
        || methodNames.has("build"),
    );
}

function collectStrictLifecycleTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const cls of scene.getClasses()) {
        if (!isAbilityLikeClass(cls)) continue;
        for (const method of cls.getMethods()) {
            if (!method.isStatic() && isLifecycleMethod(method)) {
                addMethodRef(out, method);
            }
        }
    }
    return out;
}

function collectBroadLifecycleTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const method of getSceneMethods(scene)) {
        if (isLifecycleMethod(method)) {
            addMethodRef(out, method);
        }
    }
    return out;
}

function collectStrictPageTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const cls of scene.getClasses()) {
        const methods = cls.getMethods().filter(method => !method.isStatic());
        const methodNames = new Set(methods.map(method => method.getName()));
        const looksPageLike =
            cls.hasDecorator?.("Entry")
            || cls.hasComponentDecorator?.()
            || cls.hasDecorator?.("Component")
            || methodNames.has("aboutToAppear")
            || methodNames.has("onPageShow")
            || methodNames.has("onPageHide");
        if (!looksPageLike) continue;
        for (const method of methods) {
            if (isPageMethod(method)) {
                addMethodRef(out, method);
            }
        }
    }
    return out;
}

function collectBroadPageTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const cls of scene.getClasses()) {
        if (!hasDirectLocalBuildOnlyShape(cls) && !cls.hasDecorator?.("Entry") && !cls.hasDecorator?.("Component")) {
            const names = new Set(cls.getMethods().map(method => method.getName()));
            if (!names.has("aboutToAppear") && !names.has("onPageShow") && !names.has("onPageHide")) {
                continue;
            }
        }
        for (const method of cls.getMethods()) {
            if (!method.isStatic() && isPageMethod(method)) {
                addMethodRef(out, method);
            }
        }
    }
    return out;
}

function isComponentAnchor(method: ArkMethod): boolean {
    return COMPONENT_ANCHOR_METHOD_NAMES.has(method.getName()) || isLifecycleMethod(method);
}

function isCompositionMethod(method: ArkMethod): boolean {
    return COMPOSITION_METHOD_NAMES.has(method.getName());
}

function classHasReactiveDecoratedFields(cls: ArkClass): boolean {
    for (const field of cls.getFields()) {
        for (const decorator of field.getDecorators?.() || []) {
            const kind = normalizeDecoratorKind(decorator?.getKind?.());
            if (kind && REACTIVE_FIELD_DECORATOR_NAMES.has(kind)) {
                return true;
            }
        }
    }
    return false;
}

function collectStrictCallbackTargets(scene: Scene): Set<string> {
    return collectCallbackTargetsFromScope(
        scene,
        collectExpandedCompositionScopeMethods(scene),
        [
            resolvePureEntryFrameworkCallbackRegistration,
        ],
    );
}

function resolvePureEntryAsyncServiceRegistration(
    args: { invokeExpr: any; explicitArgs: any[]; scene: Scene; sourceMethod: ArkMethod }
): { callbackArgIndexes: number[]; reason?: string } | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";

    if (methodName === "requestAsync" && ownerName === "Http") {
        return {
            callbackArgIndexes: [1],
            reason: `Pure-entry async service registration ${ownerName}.${methodName}`,
        };
    }

    if (methodName === "execute" && (ownerName === "taskpool" || ownerName === "TaskPool" || ownerName === "")) {
        return {
            callbackArgIndexes: [0],
            reason: `Pure-entry async scheduler registration ${ownerName || "@taskpool"}.${methodName}`,
        };
    }

    return null;
}

function collectStrictSceneWideCallbackTargets(scene: Scene): Set<string> {
    return new Set<string>([
        ...collectStrictSystemCallbackTargets(scene),
        ...collectStrictSchedulerCallbackTargets(scene),
    ]);
}

function collectBroadCallbackTargets(scene: Scene): Set<string> {
    return new Set<string>(collectStrictCallbackTargets(scene));
}

function collectBroadSceneWideCallbackTargets(scene: Scene): Set<string> {
    return new Set<string>(collectStrictSceneWideCallbackTargets(scene));
}

function collectBroadWatchTargets(scene: Scene): Set<string> {
    return new Set<string>(collectStrictWatchTargets(scene));
}

function collectThisFieldWrites(method: ArkMethod, watchedFields: Set<string>): string[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    const out = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const baseName = left.getBase?.()?.getName?.();
        if (baseName !== "this") continue;
        const fieldName = left.getFieldName?.() || left.getFieldSignature?.()?.getFieldName?.();
        if (!fieldName || !watchedFields.has(fieldName)) continue;
        out.add(fieldName);
    }
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function collectStrictWatchTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const cls of scene.getClasses()) {
        const methods = cls.getMethods().filter(method => !method.isStatic());
        const watchMethods = methods.filter(method => extractWatchTargets(method.getDecorators?.() || []).length > 0);
        if (watchMethods.length === 0) continue;

        const watchedFields = new Set<string>();
        for (const method of watchMethods) {
            for (const target of extractWatchTargets(method.getDecorators?.() || [])) {
                watchedFields.add(target);
            }
        }

        const anchorScope = expandPureEntryMethodsByDirectCalls(
            scene,
            methods.filter(isComponentAnchor),
        );
        const anchorWrites = anchorScope
            .filter(method => !watchMethods.includes(method))
            .flatMap(method => collectThisFieldWrites(method, watchedFields));

        if (anchorWrites.length === 0) continue;
        for (const method of watchMethods) {
            addMethodRef(out, method);
        }
    }
    return out;
}

function collectStrictReactiveBindingTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const cls of scene.getClasses()) {
        if (!classHasReactiveDecoratedFields(cls)) continue;
        for (const method of cls.getMethods()) {
            if (method.isStatic()) continue;
            if (isComponentAnchor(method) || isPageMethod(method)) {
                addMethodRef(out, method);
            }
        }
    }
    return out;
}

function collectBroadReactiveBindingTargets(scene: Scene): Set<string> {
    return new Set(collectStrictReactiveBindingTargets(scene));
}

function collectRouteUsage(scene: Scene): { valid: boolean; broad: boolean } {
    let valid = false;
    for (const method of getSceneMethods(scene)) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const methodSig = invokeExpr.getMethodSignature?.();
            const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (!ROUTE_METHOD_NAMES.has(methodName)) continue;
            const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
            if (VALID_ROUTE_OWNER_NAMES.has(ownerName)) {
                valid = true;
            }
        }
    }
    return { valid, broad: valid };
}

function methodUsesRouteParams(method: ArkMethod): { valid: boolean; broad: boolean } {
    const cfg = method.getCfg?.();
    if (!cfg) return { valid: false, broad: false };
    let valid = false;
    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const methodSig = invokeExpr.getMethodSignature?.();
        const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (methodName !== "getParams") continue;
        const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
        if (VALID_ROUTE_OWNER_NAMES.has(ownerName)) {
            valid = true;
        }
    }
    return { valid, broad: valid };
}

function collectStrictRouteConsumerTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const method of getSceneMethods(scene)) {
        if (!PAGE_METHOD_NAMES.has(method.getName())) continue;
        const usage = methodUsesRouteParams(method);
        if (usage.valid) {
            addMethodRef(out, method);
        }
    }
    return out;
}

function collectBroadRouteConsumerTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const method of getSceneMethods(scene)) {
        if (!PAGE_METHOD_NAMES.has(method.getName())) continue;
        const usage = methodUsesRouteParams(method);
        if (usage.broad) {
            addMethodRef(out, method);
        }
    }
    return out;
}

function methodHasParameterTypeName(method: ArkMethod, allowedTypeNames: Set<string>): boolean {
    const parameters = method.getParameters?.() || [];
    for (const parameter of parameters) {
        const normalizedTypeName = getNormalizedTypeName(parameter?.getType?.()?.toString?.());
        if (normalizedTypeName && allowedTypeNames.has(normalizedTypeName)) {
            return true;
        }
    }
    return false;
}

function collectHandoffUsage(scene: Scene): { valid: boolean; broad: boolean } {
    let found = false;
    for (const method of getSceneMethods(scene)) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const methodSig = invokeExpr.getMethodSignature?.();
            const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (HANDOFF_SOURCE_METHOD_NAMES.has(methodName)) {
                found = true;
            }
        }
    }
    return { valid: found, broad: found };
}

function collectStrictHandoffTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    const receiverClassNames = new Set<string>();

    for (const cls of scene.getClasses()) {
        if (!isAbilityLikeClass(cls)) continue;
        for (const method of cls.getMethods()) {
            if (method.isStatic()) continue;
            if (!HANDOFF_RECEIVER_METHOD_NAMES.has(method.getName())) continue;
            if (!methodHasParameterTypeName(method, HANDOFF_PAYLOAD_TYPE_NAMES)) continue;
            receiverClassNames.add(cls.getName());
            addMethodRef(out, method);
        }
    }

    for (const cls of scene.getClasses()) {
        if (!receiverClassNames.has(cls.getName())) continue;
        for (const method of cls.getMethods()) {
            if (method.isStatic()) continue;
            if (isLifecycleMethod(method) || isPageMethod(method)) {
                addMethodRef(out, method);
            }
        }
    }

    return out;
}

function collectStrictKeyedCallbackTargets(scene: Scene): Set<string> {
    const out = new Set<string>();
    for (const sourceMethod of getSceneMethods(scene)) {
        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            for (const reg of resolvePureEntryKnownKeyedCallbackRegistrationsFromStmt(stmt, scene, sourceMethod)) {
                addMethodRef(out, reg.callbackMethod);
            }
        }
    }
    return out;
}

function collectExpandedCompositionScopeMethods(scene: Scene): ArkMethod[] {
    const seeds = getSceneMethods(scene)
        .filter(method => !method.isStatic())
        .filter(isCompositionMethod);
    return expandPureEntryMethodsByDirectCalls(scene, seeds);
}

function collectExpandedEntryScopeMethods(scene: Scene): ArkMethod[] {
    const seeds: ArkMethod[] = [];
    for (const cls of scene.getClasses()) {
        const methods = cls.getMethods().filter(method => !method.isStatic());
        if (isAbilityLikeClass(cls)) {
            seeds.push(...methods.filter(method => isLifecycleMethod(method)));
        }
        if (isPageLikeClass(cls, methods)) {
            seeds.push(...methods.filter(method => isComponentAnchor(method)));
        }
    }
    return expandPureEntryMethodsByDirectCalls(scene, seeds);
}

function collectCallbackTargetsFromScope(
    scene: Scene,
    sourceMethods: ArkMethod[],
    resolvers: Array<(args: { invokeExpr: any; explicitArgs: any[]; scene: Scene; sourceMethod: ArkMethod }) => { callbackArgIndexes: number[]; reason?: string } | null>,
): Set<string> {
    const out = new Set<string>();
    for (const sourceMethod of sourceMethods) {
        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            for (const resolver of resolvers) {
                for (const reg of resolvePureEntryCallbackRegistrationsFromStmt(stmt, scene, sourceMethod, resolver)) {
                    addMethodRef(out, reg.callbackMethod);
                }
            }
        }
    }
    return out;
}

function collectStrictSystemCallbackTargets(scene: Scene): Set<string> {
    const out = collectCallbackTargetsFromScope(
        scene,
        collectExpandedEntryScopeMethods(scene),
        [
            resolvePureEntryFrameworkCallbackRegistration,
            resolvePureEntryChannelCallbackRegistration,
            resolvePureEntryAsyncServiceRegistration,
        ],
    );
    for (const sourceMethod of collectExpandedEntryScopeMethods(scene)) {
        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            for (const reg of resolvePureEntryControllerOptionCallbackRegistrationsFromStmt(stmt, scene, sourceMethod)) {
                addMethodRef(out, reg.callbackMethod);
            }
        }
    }
    return out;
}

function collectStrictSchedulerCallbackTargets(scene: Scene): Set<string> {
    return collectCallbackTargetsFromScope(
        scene,
        collectExpandedEntryScopeMethods(scene),
        [
            resolvePureEntrySchedulerCallbackRegistration,
        ],
    );
}

function buildOracle(
    valid: Set<string>,
    broad: Set<string>,
    entryExpectation: boolean,
    notes: string[] = [],
): PureEntryOracle {
    const validTargets = [...valid].sort((a, b) => a.localeCompare(b));
    const broadTargets = [...broad].sort((a, b) => a.localeCompare(b));
    const classification = validTargets.length > 0
        ? "positive"
        : broadTargets.length > 0
            ? "negative"
            : entryExpectation
                ? "excluded"
                : "negative";
    return {
        validTargets,
        broadTargets,
        classification,
        notes: classification === "negative" && broadTargets.length === 0
            ? [...notes, "empty-negative"]
            : notes,
    };
}

function collectGenericEntryTargets(scene: Scene): { valid: Set<string>; broad: Set<string> } {
    const routeUsage = collectRouteUsage(scene);
    const valid = new Set<string>([
        ...collectStrictLifecycleTargets(scene),
        ...collectStrictPageTargets(scene),
        ...collectStrictCallbackTargets(scene),
        ...collectStrictWatchTargets(scene),
        ...(routeUsage.valid ? [...collectStrictPageTargets(scene), ...collectStrictLifecycleTargets(scene)] : []),
    ]);
    const broad = new Set<string>([
        ...collectBroadLifecycleTargets(scene),
        ...collectBroadPageTargets(scene),
        ...collectBroadCallbackTargets(scene),
        ...collectBroadWatchTargets(scene),
        ...(routeUsage.broad ? [...collectBroadPageTargets(scene), ...collectBroadLifecycleTargets(scene)] : []),
    ]);
    return { valid, broad };
}

export function buildPureEntryOracle(
    scene: Scene,
    category: PureEntrySuiteCategory,
    entryExpectation: boolean,
): PureEntryOracle {
    switch (category) {
        case "ability_lifecycle": {
            const valid = collectStrictLifecycleTargets(scene);
            const broad = collectBroadLifecycleTargets(scene);
            return buildOracle(valid, broad, entryExpectation, ["lifecycle-only"]);
        }
        case "page_visibility": {
            const valid = collectStrictPageTargets(scene);
            const broad = collectBroadPageTargets(scene);
            return buildOracle(valid, broad, entryExpectation, ["page-visibility"]);
        }
        case "ui_event_callback": {
            const valid = collectStrictCallbackTargets(scene);
            const broad = collectBroadCallbackTargets(scene);
            return buildOracle(valid, broad, entryExpectation, ["ui-callback"]);
        }
        case "reactive_watch": {
            const valid = collectStrictWatchTargets(scene);
            const broad = collectBroadWatchTargets(scene);
            return buildOracle(valid, broad, entryExpectation, ["watch-only"]);
        }
        case "reactive_binding":
        {
            const valid = new Set<string>([
                ...collectStrictReactiveBindingTargets(scene),
                ...collectStrictWatchTargets(scene),
            ]);
            const broad = new Set<string>([
                ...collectBroadReactiveBindingTargets(scene),
                ...collectBroadWatchTargets(scene),
            ]);
            return buildOracle(valid, broad, entryExpectation, ["reactive-binding"]);
        }
        case "reactive_composition": {
            const valid = new Set<string>([
                ...collectStrictPageTargets(scene),
                ...collectStrictWatchTargets(scene),
                ...collectStrictReactiveBindingTargets(scene),
            ]);
            const broad = new Set<string>([
                ...collectBroadPageTargets(scene),
                ...collectBroadWatchTargets(scene),
                ...collectBroadReactiveBindingTargets(scene),
            ]);
            return buildOracle(valid, broad, entryExpectation, ["reactive-composition"]);
        }
        case "route_handoff":
        {
            const routeUsage = collectRouteUsage(scene);
            const valid = routeUsage.valid
                ? new Set<string>([
                    ...collectStrictPageTargets(scene),
                    ...collectStrictLifecycleTargets(scene),
                    ...collectStrictRouteConsumerTargets(scene),
                    ...collectStrictKeyedCallbackTargets(scene),
                ])
                : new Set<string>();
            const broad = routeUsage.broad
                ? new Set<string>([
                    ...collectBroadPageTargets(scene),
                    ...collectBroadLifecycleTargets(scene),
                    ...collectBroadRouteConsumerTargets(scene),
                    ...collectStrictKeyedCallbackTargets(scene),
                ])
                : new Set<string>();
            return buildOracle(valid, broad, entryExpectation, ["navigation-handoff"]);
        }
        case "cross_component_handoff": {
            const handoffUsage = collectHandoffUsage(scene);
            const validTargets = collectStrictHandoffTargets(scene);
            const valid = handoffUsage.valid
                ? new Set<string>(validTargets)
                : new Set<string>();
            const broad = handoffUsage.broad
                ? new Set<string>(validTargets)
                : new Set<string>();
            return buildOracle(valid, broad, entryExpectation, ["ability-handoff"]);
        }
        case "event_async": {
            const valid = collectStrictSceneWideCallbackTargets(scene);
            const broad = collectBroadSceneWideCallbackTargets(scene);
            return buildOracle(valid, broad, entryExpectation, ["async-callback"]);
        }
        case "framework_probe": {
            const { valid, broad } = collectGenericEntryTargets(scene);
            return buildOracle(valid, broad, entryExpectation, ["framework-probe"]);
        }
    }
}
