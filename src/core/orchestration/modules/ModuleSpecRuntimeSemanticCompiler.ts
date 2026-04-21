import type {
    ModuleAbilityHandoffSemantic,
    ModuleContainerSemantic,
    ModuleEventEmitterSemantic,
    ModuleKeyedStorageSemantic,
    ModuleRouteBridgeSemantic,
    ModuleSemantic,
    ModuleSpec,
    ModuleStateBindingSemantic,
} from "../../kernel/contracts/ModuleSpec";
import type { TaintModule } from "../../kernel/contracts/ModuleContract";
import { createHarmonyAbilityHandoffSemanticModule } from "./harmony_semantics/ability_handoff";
import { createHarmonyKeyedStorageSemanticModule } from "./harmony_semantics/appstorage";
import { createHarmonyEventEmitterSemanticModule } from "./harmony_semantics/emitter";
import { createHarmonyRouteBridgeSemanticModule } from "./harmony_semantics/router";
import { createHarmonyStateBindingSemanticModule } from "./harmony_semantics/state";
import { createTsjsContainerSemanticModule } from "../../../models/kernel/modules/tsjs/container";

function compileContainerSemantic(spec: ModuleSpec, semantic: ModuleContainerSemantic): TaintModule {
    return createTsjsContainerSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        families: semantic.families,
        capabilities: semantic.capabilities,
    });
}

function compileAbilityHandoffSemantic(spec: ModuleSpec, semantic: ModuleAbilityHandoffSemantic): TaintModule {
    return createHarmonyAbilityHandoffSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        startMethods: semantic.startMethods,
        targetMethods: semantic.targetMethods,
    });
}

function compileEventEmitterSemantic(spec: ModuleSpec, semantic: ModuleEventEmitterSemantic): TaintModule {
    return createHarmonyEventEmitterSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        onMethods: semantic.onMethods,
        emitMethods: semantic.emitMethods,
        channelArgIndexes: semantic.channelArgIndexes,
        payloadArgIndex: semantic.payloadArgIndex,
        callbackArgIndex: semantic.callbackArgIndex,
        callbackParamIndex: semantic.callbackParamIndex,
        maxCandidates: semantic.maxCandidates,
    });
}

function compileKeyedStorageSemantic(spec: ModuleSpec, semantic: ModuleKeyedStorageSemantic): TaintModule {
    return createHarmonyKeyedStorageSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        storageClasses: semantic.storageClasses,
        writeMethods: semantic.writeMethods,
        readMethods: semantic.readMethods,
        propDecorators: semantic.propDecorators,
        linkDecorators: semantic.linkDecorators,
    });
}

function compileRouteBridgeSemantic(spec: ModuleSpec, semantic: ModuleRouteBridgeSemantic): TaintModule {
    return createHarmonyRouteBridgeSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        pushMethods: semantic.pushMethods,
        getMethods: semantic.getMethods,
        navDestinationClassNames: semantic.navDestinationClassNames,
        navDestinationRegisterMethods: semantic.navDestinationRegisterMethods,
        frameworkSignatureHints: semantic.frameworkSignatureHints,
        payloadUnwrapPrefixes: semantic.payloadUnwrapPrefixes,
    });
}

function compileStateBindingSemantic(spec: ModuleSpec, semantic: ModuleStateBindingSemantic): TaintModule {
    return createHarmonyStateBindingSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        stateDecorators: semantic.stateDecorators,
        propDecorators: semantic.propDecorators,
        linkDecorators: semantic.linkDecorators,
        provideDecorators: semantic.provideDecorators,
        consumeDecorators: semantic.consumeDecorators,
        eventDecorators: semantic.eventDecorators,
    });
}

export function compileRuntimeSemanticModule(
    spec: ModuleSpec,
    semantic: ModuleSemantic & { id: string },
): TaintModule | undefined {
    switch (semantic.kind) {
        case "container":
            return compileContainerSemantic(spec, semantic);
        case "ability_handoff":
            return compileAbilityHandoffSemantic(spec, semantic);
        case "keyed_storage":
            return compileKeyedStorageSemantic(spec, semantic);
        case "event_emitter":
            return compileEventEmitterSemantic(spec, semantic);
        case "route_bridge":
            return compileRouteBridgeSemantic(spec, semantic);
        case "state_binding":
            return compileStateBindingSemantic(spec, semantic);
        default:
            return undefined;
    }
}
