import { taint } from "./taint_mock";

export function array_reduceRight_001_T(taint_src: string) {
  const arr = [taint_src, "_"];
  const result = arr.reduceRight((acc, item) => item, "_");
  taint.Sink(result);
}
