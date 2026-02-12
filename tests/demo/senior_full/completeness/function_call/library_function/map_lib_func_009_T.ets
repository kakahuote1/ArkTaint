import { taint } from "./taint_mock";


/**
 * Introduction 库函�?map_keys
 */
export function map_lib_func_009_T(taint_src : string) {
  let map = new Map<string,string>();
  map.set(taint_src,"t");
  map.set("tt","a");
  taint.Sink(map.keys());
}
