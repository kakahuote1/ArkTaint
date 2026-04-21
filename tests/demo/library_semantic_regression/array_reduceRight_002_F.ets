import { taint } from "./taint_mock";

export function array_reduceRight_002_F(taint_src: string) {
  const arr = ["_", "_"];
  const result = arr.reduceRight((acc, item) => item, "_");
  taint.Sink(result);
}
