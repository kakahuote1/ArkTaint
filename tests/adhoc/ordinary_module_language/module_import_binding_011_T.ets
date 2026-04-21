import { taint } from "./taint_mock";
import { exportedSeed, writeExportedSeed } from "./binding_shared";

export function module_import_binding_011_T(taint_src: string): void {
    writeExportedSeed(taint_src);
    taint.Sink(exportedSeed);
}
