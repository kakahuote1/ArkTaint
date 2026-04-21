import { taint } from "./taint_mock";

export function array_from_mapper_002_F(taint_src: string) {
  const src = ["_", "_"];
  Array.from(src, item => {
    taint.Sink(item);
    return "_";
  });
}
