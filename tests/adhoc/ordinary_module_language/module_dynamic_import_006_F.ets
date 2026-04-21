import { taint } from "./taint_mock";

export async function module_dynamic_import_006_F(taint_src: string): Promise<void> {
  const shared = await import("./shared");
  shared.setSharedValue("_");
  taint.Sink(shared.getSharedValue());
}
