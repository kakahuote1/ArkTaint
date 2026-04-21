import { taint } from "./taint_mock";

export function object_fromEntries_001_T(taint_src: string) {
  const pair1: string[] = [];
  pair1[0] = "a";
  pair1[1] = taint_src;

  const pair2: string[] = [];
  pair2[0] = "b";
  pair2[1] = "_";

  const pairs: string[][] = [];
  pairs[0] = pair1;
  pairs[1] = pair2;

  const obj = Object.fromEntries(pairs);
  taint.Sink(obj.a);
}
