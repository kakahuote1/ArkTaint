import { defineEnginePlugin } from "@arktaint/plugin";

function findMethod(api: any, methodName: string): any | undefined {
    return api.getScene().getMethods().find((candidate: any) => candidate.getName?.() === methodName);
}

function projectApiEffectAssetFromMethod(input: any): any {
    const path = require("path");
    const helperPath = path.join(process.cwd(), "out", "tests", "helpers", "ApiEffectTestAssets");
    return require(helperPath).projectApiEffectAssetFromMethod(input);
}

export default defineEnginePlugin({
    name: "fixture.entry_and_rules",

    onStart(api) {
        const sourceMethod = findMethod(api, "Source");
        const sinkMethod = findMethod(api, "Sink");
        if (!sourceMethod || !sinkMethod) {
            return;
        }
        const source = projectApiEffectAssetFromMethod({
            id: "source.fixture.plugin.source",
            role: "source",
            method: sourceMethod,
            endpoint: { base: { kind: "return" } },
            sourceKind: "call_return",
        });
        const sink = projectApiEffectAssetFromMethod({
            id: "sink.fixture.plugin.sink",
            role: "sink",
            method: sinkMethod,
            endpoint: { base: { kind: "arg", index: 0 } },
            sinkKind: "test",
        });
        api.addSourceRule({
            id: "source.fixture.plugin.source",
            sourceKind: "call_return",
            match: {
                kind: "canonical_api_id_equals",
                value: source.canonicalApiDescriptor.canonicalApiId,
            },
            apiEffect: source.apiEffect,
            target: "result",
        });
        api.addSinkRule({
            id: "sink.fixture.plugin.sink",
            match: {
                kind: "canonical_api_id_equals",
                value: sink.canonicalApiDescriptor.canonicalApiId,
            },
            apiEffect: sink.apiEffect,
            target: "arg0",
        });
    },

    onEntry(api) {
        const scene = api.getScene();
        const method = scene.getMethods().find(candidate => candidate.getName?.() === "pluginOnlyEntry");
        if (method) {
            api.addEntry(method);
        }
    },
});

export const disabledInlinePlugin = defineEnginePlugin({
    name: "fixture.disabled_inline",
    enabled: false,
    onStart() {
        throw new Error("disabled inline engine plugin should not run");
    },
});
