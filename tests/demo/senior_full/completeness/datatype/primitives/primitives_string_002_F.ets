import { taint } from "./taint_mock";


/**
 * Introduction 基础数据类型-string
 */


export function primitives_string_002_F(taint_src : string) : void {
  let _t = taint_src;
  let _clean = "clean";
  taint.Sink(_clean);
}
