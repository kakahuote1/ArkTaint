import { taint } from "./taint_mock";
/**
 * Introduction 基础数据类型-number
 */


export function primitives_number_001_T(taint_src : number) : void {
  taint.Sink(taint_src);
}
