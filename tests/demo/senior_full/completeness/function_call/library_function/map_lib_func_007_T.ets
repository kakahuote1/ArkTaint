import { taint } from "./taint_mock";


/**
 * Introduction 库函�?map_values
 */
export function map_lib_func_007_T(taint_src : string) {
  let map = new Map<string,string>();
  map.set("t",taint_src);
  map.set("tt","a");
  taint.Sink(map.values());
}
