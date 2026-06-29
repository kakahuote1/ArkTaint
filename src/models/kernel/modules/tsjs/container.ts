import { createBuiltinModuleAsset } from "../../moduleAssetHelpers";
import { officialInvokeSurfaceFromId } from "../../moduleAssetHelpers";

const mutationCanonicalApiIds = [
    "api:official:tsjs:module=typescript%2Flib%2Flib.es5.d.ts:file=typescript%2Flib%2Flib.es5.d.ts:export=interface%3AArray:decl=interface%3AArray:member=method%3Ainstance%3Apush:invoke=call:params=0%3Arest%3AT%5B%5D:ret=number",
    "api:official:tsjs:module=typescript%2Flib%2Flib.es2015.collection.d.ts:file=typescript%2Flib%2Flib.es2015.collection.d.ts:export=interface%3AMap:decl=interface%3AMap:member=method%3Ainstance%3Aset:invoke=call:params=0%3AK%2C1%3AV:ret=this",
    "api:official:tsjs:module=typescript%2Flib%2Flib.es2015.collection.d.ts:file=typescript%2Flib%2Flib.es2015.collection.d.ts:export=interface%3ASet:decl=interface%3ASet:member=method%3Ainstance%3Aadd:invoke=call:params=0%3AT:ret=this",
];

const accessCanonicalApiIds = [
    "api:official:tsjs:module=typescript%2Flib%2Flib.es5.d.ts:file=typescript%2Flib%2Flib.es5.d.ts:export=interface%3AArray:decl=interface%3AArray:member=method%3Ainstance%3Apop:invoke=call:params=none:ret=T%20%7C%20undefined",
    "api:official:tsjs:module=typescript%2Flib%2Flib.es2015.collection.d.ts:file=typescript%2Flib%2Flib.es2015.collection.d.ts:export=interface%3AMap:decl=interface%3AMap:member=method%3Ainstance%3Aget:invoke=call:params=0%3AK:ret=V%20%7C%20undefined",
];

const mutationSurfaces = mutationCanonicalApiIds.map(officialInvokeSurfaceFromId);
const accessSurfaces = accessCanonicalApiIds.map(officialInvokeSurfaceFromId);
const containerSurfaces = [...mutationSurfaces, ...accessSurfaces];

const tsjsContainerModuleAsset = createBuiltinModuleAsset({
    id: "tsjs.container",
    description: "Built-in TS/JS container and collection semantics.",
    semanticsFamily: "tsjs-container",
    role: "module",
    capability: "module.container",
    surfaces: containerSurfaces,
    payload: {
        families: ["array", "map", "set"],
        capabilities: ["store", "nested_store", "mutation_base", "load", "view"],
        mutationCanonicalApiIds,
        accessCanonicalApiIds,
    },
});

export default tsjsContainerModuleAsset;
