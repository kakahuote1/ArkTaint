import { taint } from "./taint_mock";

export function array_concat_copy_010_F(taint_src: string) {
  const unused = [taint_src];
  const arr = ["_"];
  const copy = arr.concat(["_"]);
  taint.Sink(copy.at(0)!);
  void unused;
}
