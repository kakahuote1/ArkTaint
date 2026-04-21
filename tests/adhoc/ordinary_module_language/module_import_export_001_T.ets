import { taint } from "./taint_mock";
import { getSharedValue, setSharedValue } from "./shared";

export function module_import_export_001_T(taint_src: string): void {
  setSharedValue(taint_src);
  taint.Sink(getSharedValue());
}
