import { taint } from "./taint_mock";


/**
 * Introduction 库函�?map_entries
 */
export function map_lib_func_006_F(taint_src : string) {
  let map = new Map<string,string>();
  map.set("t","_");
  map.set("tt","a");
  taint.Sink(map.entries());
}
