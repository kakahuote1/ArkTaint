import { taint } from "./taint_mock";

export class BuiltinPluginDemoFixture {
    build(): void {
        const safe = "no-plugin";
        taint.BuiltinPluginSink(safe);
    }

    builtinPluginDemoEntry(): void {
        const value = taint.BuiltinPluginSource();
        taint.BuiltinPluginSink(value);
    }
}
