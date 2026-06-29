import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { expandClassLocalMethodsByDirectCalls } from "../../shared/ExplicitEntryScopeResolver";
import {
    collectClassWatchTargets,
    collectThisFieldWrites,
    collectWatchedFieldWritesFromMethods,
    extractWatchTargets,
    findReactiveAnchorMethods,
    isOfficialArkMainWatchDecoratorKind,
    normalizeDecoratorKind,
} from "./ArkMainFactResolverUtils";
import { collectQualifiedDecoratorCandidates } from "./ArkMainStructuralDiscovery";

export function collectReactiveFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    const decoratorCandidates = collectQualifiedDecoratorCandidates(scene.getClasses());
    const methodDecoratorKeys = new Set(
        decoratorCandidates
            .filter(candidate => candidate.targetKind === "method")
            .map(candidate => `${candidate.ownerClass.getName()}::${candidate.targetName}`),
    );
    for (const method of scene.getMethods()) {
        const decorators = method.getDecorators?.() || [];
        for (const decorator of decorators) {
            const kind = normalizeDecoratorKind(decorator?.getKind?.());
            if (!isOfficialArkMainWatchDecoratorKind(kind)) continue;
            const ownerName = method.getDeclaringArkClass?.().getName?.() || "";
            context.addFact({
                phase: "reactive_handoff",
                kind: "watch_handler",
                method,
                reason: `Reactive watch handler ${method.getName()}`,
                sourceMethod: method,
                watchTargets: extractWatchTargets(decorators),
                entryFamily: "reactive_watch",
                entryShape: "decorator_slot",
                recognitionLayer: methodDecoratorKeys.has(`${ownerName}::${method.getName()}`)
                    ? "qualified_decorator_first_layer"
                    : undefined,
            });
        }
    }

    // Field-level watcher declarations are only honored when exact decorator
    // identity evidence is available through the official asset registry.
    const watchHandlerSigs = new Set(
        context.facts
            .filter(f => f.kind === "watch_handler")
            .map(f => f.method.getSignature?.()?.toString?.() || ""),
    );
    for (const cls of scene.getClasses()) {
        for (const field of cls.getFields?.() || []) {
            const fieldDecorators = field.getDecorators?.() || [];
            const handlerNames = extractWatchTargets(fieldDecorators);
            if (handlerNames.length === 0) continue;

            const fieldName = field.getName?.() || "";
            const ownerName = cls.getName?.() || "";
            for (const handlerName of handlerNames) {
                const handler = cls.getMethods().find(m => m.getName() === handlerName);
                if (!handler) continue;
                const sig = handler.getSignature?.()?.toString?.() || "";
                if (sig && watchHandlerSigs.has(sig)) continue;
                watchHandlerSigs.add(sig);

                context.addFact({
                    phase: "reactive_handoff",
                    kind: "watch_handler",
                    method: handler,
                    reason: `Reactive watch handler ${handlerName} bound by exact field watcher declaration ${fieldName}`,
                    sourceMethod: handler,
                    watchTargets: [fieldName],
                    entryFamily: "reactive_watch",
                    entryShape: "decorator_slot",
                    recognitionLayer: methodDecoratorKeys.has(`${ownerName}::${handlerName}`)
                        ? "qualified_decorator_first_layer"
                        : undefined,
                });
            }
        }
    }

    for (const cls of scene.getClasses()) {
        const watchTargets = collectClassWatchTargets(context.facts, cls);
        if (watchTargets.length > 0) {
            const watchedFields = new Set(watchTargets);
            for (const method of cls.getMethods().filter(candidate => !candidate.isStatic())) {
                if ((method.getDecorators?.() || []).some(decorator => {
                    const kind = normalizeDecoratorKind(decorator?.getKind?.());
                    return isOfficialArkMainWatchDecoratorKind(kind);
                })) {
                    continue;
                }
                const writtenFields = collectThisFieldWrites(method, watchedFields);
                if (writtenFields.length === 0) continue;
                context.addFact({
                    phase: "reactive_handoff",
                    kind: "watch_source",
                    method,
                    reason: `Method ${method.getName()} writes watched field(s) ${writtenFields.join(", ")}`,
                    schedule: false,
                    sourceMethod: method,
                    reactiveFieldNames: writtenFields,
                });
            }

            const reactiveAnchorMethods = findReactiveAnchorMethods(cls);
            for (const anchorMethod of reactiveAnchorMethods) {
                const anchorScope = expandClassLocalMethodsByDirectCalls(scene, [anchorMethod]);
                const writtenFields = collectWatchedFieldWritesFromMethods(anchorScope, watchedFields);
                if (writtenFields.length === 0) continue;
                context.addFact({
                    phase: "reactive_handoff",
                    kind: "watch_source",
                    method: anchorMethod,
                    reason: `Reactive anchor ${anchorMethod.getName()} reaches watched field write(s) ${writtenFields.join(", ")} through direct-call closure`,
                    schedule: false,
                    sourceMethod: anchorMethod,
                    reactiveFieldNames: writtenFields,
                });
            }
            continue;
        }
    }
}

