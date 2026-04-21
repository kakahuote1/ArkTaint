import { taint } from "./taint_mock";

export async function module_dynamic_namespace_016_F(taint_src: string): Promise<void> {
    const binding = await import("./binding_shared");
    binding.writeExportedSeed("_");
    taint.Sink(binding.exportedSeed);
}
