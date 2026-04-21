import { defineEnginePlugin } from "@arktaint/plugin";

export default defineEnginePlugin({
    name: "fixture.entry_and_rules",

    onStart(api) {
        api.addSourceRule({
            id: "source.fixture.plugin.source",
            sourceKind: "call_return",
            match: {
                kind: "method_name_equals",
                value: "Source",
            },
            target: "result",
        });
        api.addSinkRule({
            id: "sink.fixture.plugin.sink",
            match: {
                kind: "method_name_equals",
                value: "Sink",
            },
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
