import { taint } from "./taint_mock";

export function flow_order_002_F(taint_src: string) {
  let result = "";
  taint.Sink(result);
  result = taint_src;
}
