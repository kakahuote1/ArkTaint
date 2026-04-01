import { taint } from "./taint_mock";
import { getSharedValue, setSharedValue } from "./shared";

export function module_import_export_002_F(taint_src: string): void {
  setSharedValue("_");
  taint.Sink(getSharedValue());
}
