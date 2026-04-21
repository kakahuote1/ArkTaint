import { taint } from "./taint_mock";

/**
 * Introduction lambda表达�?
 */
export function lambda_expression_002_F(taint_src : string) {
  let _t = taint_src;
  let lambda2 = (a:string) => a;
  let clean = lambda2("_");
  taint.Sink(clean);
}
