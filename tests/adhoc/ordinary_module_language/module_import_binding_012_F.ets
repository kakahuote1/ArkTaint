import { taint } from "./taint_mock";
import { exportedSeed, writeExportedSeed } from "./binding_shared";

export function module_import_binding_012_F(taint_src: string): void {
    writeExportedSeed("_");
    taint.Sink(exportedSeed);
}
