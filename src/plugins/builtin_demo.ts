import { ArkMethod } from "../../arkanalyzer/lib/core/model/ArkMethod";
import { defineEnginePlugin } from "../core/orchestration/plugins/EnginePlugin";

const DEMO_ENTRY_NAME = "builtinPluginDemoEntry";
const DEMO_SOURCE_NAME = "BuiltinPluginSource";
const DEMO_SINK_NAME = "BuiltinPluginSink";

function findMethodByName(methods: ArkMethod[], methodName: string): ArkMethod | undefined {
    return methods.find(method => method.getName?.() === methodName);
}

export default defineEnginePlugin({
    name: "demo.builtin_entry_and_rules",
    onStart(api) {
        const methods = api.getScene().getMethods();
        if (!findMethodByName(methods, DEMO_ENTRY_NAME)) {
            return;
        }
        api.addSourceRule({
            id: "source.demo.builtin_plugin.source",
            sourceKind: "call_return",
            match: {
                kind: "method_name_equals",
                value: DEMO_SOURCE_NAME,
            },
            target: "result",
        });
        api.addSinkRule({
            id: "sink.demo.builtin_plugin.sink",
            match: {
                kind: "method_name_equals",
                value: DEMO_SINK_NAME,
            },
            target: "arg0",
        });
    },
    onEntry(api) {
        const methods = api.getScene().getMethods();
        const demoEntry = findMethodByName(methods, DEMO_ENTRY_NAME);
        if (demoEntry) {
            api.addEntry(demoEntry);
        }
    },
});
