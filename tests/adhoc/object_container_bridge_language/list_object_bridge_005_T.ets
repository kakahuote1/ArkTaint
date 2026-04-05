import List from "@ohos.util.List";
import { taint } from "./taint_mock";

export function list_object_bridge_005_T(taint_src: string): void {
  const hot = { payload: taint_src };
  const clean = { payload: "_" };
  const list = new List<any>();
  list.add(hot);
  list.add(clean);
  taint.Sink(list.get(0).payload);
}
