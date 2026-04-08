import { taint } from "./taint_mock";

class BridgeBox {
    b: string = "";
}

export class PluginRuntimeFixture {
    build(): void {
        const value = taint.Source();
        const alias = value;
        taint.Sink(alias);
    }

    pluginOnlyEntry(): void {
        const value = taint.Source();
        const alias = value;
        taint.Sink(alias);
    }

    extraCheckEntry(): void {
        const pluginCheck = "plugin-check";
        taint.Sink(pluginCheck);
    }

    manualFlowEntry(): void {
        taint.Source();
        const safe = "safe";
        taint.Sink(safe);
    }

    manualSyntheticEntry(): void {
        taint.Source();
        const safe = "safe";
        taint.Sink(safe);
    }

    manualBridgeEntry(): void {
        taint.Source();
        const box = new BridgeBox();
        const bridged = box.b;
        taint.Sink(bridged);
    }
}
