import { taint } from "./taint_mock";

class Box {
  info: string = "";
}

function taintOther(box: Box, taint_src: string): void {
  box = new Box();
  box.info = taint_src;
}

export function instance_rebind_safe_007_F(taint_src: string): void {
  const box = new Box();
  taintOther(box, taint_src);
  taint.Sink(box.info);
}
