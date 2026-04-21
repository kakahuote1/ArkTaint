import { taint } from "./taint_mock";

export function array_from_mapper_001_T(taint_src: string) {
  const src = [taint_src, "_"];
  Array.from(src, item => {
    taint.Sink(item);
    return "_";
  });
}
