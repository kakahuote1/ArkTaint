import { taint } from "./taint_mock";

export async function module_dynamic_namespace_015_T(taint_src: string): Promise<void> {
    const binding = await import("./binding_shared");
    binding.writeExportedSeed(taint_src);
    taint.Sink(binding.exportedSeed);
}
