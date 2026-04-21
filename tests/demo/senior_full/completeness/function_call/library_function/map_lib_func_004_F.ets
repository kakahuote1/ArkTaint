import { taint } from "./taint_mock";


/**
 * Introduction 库函�?map_get
 */
export function map_lib_func_004_F(taint_src : string) {
  let map = new Map<string,string>();
  map.set("t","_");
  taint.Sink(map.get("t")!);
}
