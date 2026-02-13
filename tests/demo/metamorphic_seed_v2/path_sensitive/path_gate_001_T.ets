import { taint } from "./taint_mock";

export function path_gate_001_T(taint_src: string) {
  let res = "";
  if (2 > 1) {
    res = taint_src;
  } else {
    res = "_";
  }
  taint.Sink(res);
}
