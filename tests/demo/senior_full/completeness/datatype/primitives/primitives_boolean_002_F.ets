import { taint } from "./taint_mock";
/**
 * Introduction 基础数据类型-boolean
 */


export function primitives_boolean_002_F(taint_src : boolean) : void {
  let _t  = taint_src;
  let _clean = true;
  taint.Sink(_clean);
}
