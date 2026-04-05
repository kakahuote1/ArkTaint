import { taint } from "./taint_mock";

class Box {
  info: string = "";
}

export function instance_alias_taint_009_T(taint_src: string): void {
  const box = new Box();
  const alias = box;
  alias.info = taint_src;
  taint.Sink(box.info);
}
