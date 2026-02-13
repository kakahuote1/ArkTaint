import { taint } from "./taint_mock";

export function flow_order_001_T(taint_src: string) {
  let result = "";
  result = taint_src;
  taint.Sink(result);
}
