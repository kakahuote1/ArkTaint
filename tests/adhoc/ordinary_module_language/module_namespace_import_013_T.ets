import { taint } from "./taint_mock";
import * as binding from "./binding_shared";

export function module_namespace_import_013_T(taint_src: string): void {
    binding.writeExportedBox(taint_src);
    taint.Sink(binding.exportedBox.seed);
}
