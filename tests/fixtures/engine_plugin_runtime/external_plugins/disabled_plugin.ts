import { defineEnginePlugin } from "../../../../src/core/orchestration/plugins/EnginePlugin";

export default defineEnginePlugin({
    name: "fixture.disabled_file",
    enabled: false,
    onStart() {
        throw new Error("disabled engine plugin file should not run");
    },
});
