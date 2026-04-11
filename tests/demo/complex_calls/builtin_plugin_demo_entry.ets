import { taint } from "./taint_mock";

/**
 * Used by engine plugin `demo.builtin_entry_and_rules` (onStart):
 * registers a call_return source on this method name.
 */
export function BuiltinPluginSource(): string {
    return "demo_seed";
}

/**
 * Used by engine plugin `demo.builtin_entry_and_rules` (onEntry):
 * adds this method as an extra analysis entry so BuiltinPluginSource() is reachable.
 */
export function builtinPluginDemoEntry(): void {
    const x = BuiltinPluginSource();
    taint.Sink(x);
}
