import { ArkMethod } from "../../arkanalyzer/out/src/core/model/ArkMethod";
import { defineEnginePlugin } from "../core/orchestration/plugins/EnginePlugin";

const DEMO_ENTRY_NAME = "builtinPluginDemoEntry";

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
    },
    onEntry(api) {
        const methods = api.getScene().getMethods();
        const demoEntry = findMethodByName(methods, DEMO_ENTRY_NAME);
        if (demoEntry) {
            api.addEntry(demoEntry);
        }
    },
});
