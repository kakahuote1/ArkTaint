import { taint } from "./taint_mock";
import * as binding from "./binding_shared";

export function module_namespace_import_014_F(taint_src: string): void {
    binding.writeExportedBox("_");
    taint.Sink(binding.exportedBox.seed);
}
