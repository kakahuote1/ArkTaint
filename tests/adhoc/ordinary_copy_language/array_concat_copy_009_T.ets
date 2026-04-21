import { taint } from "./taint_mock";

export function array_concat_copy_009_T(taint_src: string) {
  const arr = [taint_src];
  const copy = arr.concat(["_"]);
  taint.Sink(copy.at(0)!);
}
