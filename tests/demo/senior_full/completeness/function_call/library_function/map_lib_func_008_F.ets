import { taint } from "./taint_mock";


/**
 * Introduction 库函�?map_values
 */
export function map_lib_func_008_F(taint_src : string) {
  let map = new Map<string,string>();
  map.set("t","_");
  map.set("tt","a");
  taint.Sink(map.values());
}
