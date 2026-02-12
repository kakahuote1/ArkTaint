import { taint } from "./taint_mock";
/**
 * Introduction 异常抛出-finally�?
 */

export function exception_finally_002_F(taint_src : string) {
  try {}
  catch (e) {}
  finally {
    let _t = taint_src;
    let clean = "_";
    taint.Sink(clean);
  }
}
