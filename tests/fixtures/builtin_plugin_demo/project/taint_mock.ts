export class taint {
    static BuiltinPluginSource(): string {
        return "builtin-plugin-source";
    }

    static BuiltinPluginSink(_value: string): void {
        // sink marker for builtin plugin demo
    }
}
