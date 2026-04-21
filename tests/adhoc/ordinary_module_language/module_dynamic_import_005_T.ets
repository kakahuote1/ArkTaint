import { taint } from "./taint_mock";

export async function module_dynamic_import_005_T(taint_src: string): Promise<void> {
  const shared = await import("./shared");
  shared.setSharedValue(taint_src);
  taint.Sink(shared.getSharedValue());
}
