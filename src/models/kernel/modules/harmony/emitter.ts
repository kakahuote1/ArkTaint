import type { AssetDocumentBase } from "../../../../core/assets/schema";
import { officialInvokeSurfaceFromId } from "../../moduleAssetHelpers";

const rawOnCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aon:invoke=call:params=0%3AInnerEvent%2C1%3ACallback%3CEventData%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aon:invoke=call:params=0%3Astring%2C1%3ACallback%3CEventData%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aon:invoke=call:params=0%3Astring%2C1%3ACallback%3CEventData%3E%20%7C%20Callback%3CGenericEventData%3CT%3E%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aon:invoke=call:params=0%3Astring%2C1%3ACallback%3CGenericEventData%3CT%3E%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aonce:invoke=call:params=0%3AInnerEvent%2C1%3ACallback%3CEventData%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aonce:invoke=call:params=0%3Astring%2C1%3ACallback%3CEventData%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aonce:invoke=call:params=0%3Astring%2C1%3ACallback%3CGenericEventData%3CT%3E%3E:ret=void",
];

const rawEmitPayloadArg1CanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3AInnerEvent%2C1%3A%3F%3AEventData:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3Astring%2C1%3A%3F%3AEventData:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3Astring%2C1%3A%3F%3AEventData%20%7C%20GenericEventData%3CT%3E:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3Astring%2C1%3A%3F%3AGenericEventData%3CT%3E:ret=void",
];

const emitPayloadArg2CanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3Astring%2C1%3AOptions%2C2%3A%3F%3AEventData:ret=void",
    "api:official:openharmony:module=%40ohos.events.emitter:file=api%2F%40ohos.events.emitter.d.ts:export=default%3Aemitter:decl=namespace%3Aemitter:member=function%3Aemit:invoke=call:params=0%3Astring%2C1%3AOptions%2C2%3A%3F%3AGenericEventData%3CT%3E:ret=void",
];

function usesInnerEventChannel(canonicalApiId: string): boolean {
    return decodeURIComponent(canonicalApiId).includes("params=0:InnerEvent");
}

const onCanonicalApiIds = rawOnCanonicalApiIds.filter(canonicalApiId => !usesInnerEventChannel(canonicalApiId));
const emitPayloadArg1CanonicalApiIds = rawEmitPayloadArg1CanonicalApiIds.filter(canonicalApiId => !usesInnerEventChannel(canonicalApiId));

const emitCanonicalApiIds = [
    ...emitPayloadArg1CanonicalApiIds,
    ...emitPayloadArg2CanonicalApiIds,
];

const emitterSurfaces = [
    ...onCanonicalApiIds,
    ...emitCanonicalApiIds,
].map(officialInvokeSurfaceFromId);

const payloadArg1TemplateId = "template:harmony.emitter:payload-arg1";
const payloadArg2TemplateId = "template:harmony.emitter:payload-arg2";

const harmonyEmitterModuleAsset: AssetDocumentBase = {
    id: "harmony.emitter",
    plane: "module",
    status: "official",
    surfaces: emitterSurfaces,
    bindings: emitterSurfaces.map((surface, index) => {
        const templateRefs = [
            ...(onCanonicalApiIds.includes(surface.canonicalApiId) || emitPayloadArg1CanonicalApiIds.includes(surface.canonicalApiId)
                ? [payloadArg1TemplateId]
                : []),
            ...(onCanonicalApiIds.includes(surface.canonicalApiId) || emitPayloadArg2CanonicalApiIds.includes(surface.canonicalApiId)
                ? [payloadArg2TemplateId]
                : []),
        ];
        return {
            bindingId: `binding:harmony.emitter:${String(index + 1).padStart(4, "0")}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId: "harmony.emitter",
            plane: "module",
            role: "handoff",
            effectTemplateRefs: templateRefs,
            semanticsFamily: "harmony-event-emitter",
            metadata: {
                description: "Built-in Harmony event emitter bridges.",
            },
            completeness: "complete",
            confidence: "certain",
        };
    }),
    effectTemplates: [
        {
            id: payloadArg1TemplateId,
            kind: "module.eventEmitter",
            onCanonicalApiIds,
            emitCanonicalApiIds: emitPayloadArg1CanonicalApiIds,
            channelArgIndexes: [0],
            payloadArgIndex: 1,
            callbackArgIndex: 1,
            callbackParamIndex: 0,
            maxCandidates: 8,
            confidence: "certain",
        },
        {
            id: payloadArg2TemplateId,
            kind: "module.eventEmitter",
            onCanonicalApiIds,
            emitCanonicalApiIds: emitPayloadArg2CanonicalApiIds,
            channelArgIndexes: [0],
            payloadArgIndex: 2,
            callbackArgIndex: 1,
            callbackParamIndex: 0,
            maxCandidates: 8,
            confidence: "certain",
        },
    ],
    provenance: {
        source: "builtin",
    },
};

export default harmonyEmitterModuleAsset;
