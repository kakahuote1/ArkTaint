import { taint } from "./taint_mock";

/**
 * Introduction lambda表达�?
 */
export function lambda_expression_001_T(taint_src : string) {
  let lambda1 = (a:string) => a;
  let t = lambda1(taint_src);
  taint.Sink(t);
}
