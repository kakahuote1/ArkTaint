import { taint } from "./taint_mock";

class Box {
  info: string = "";
}

export function instance_peer_safe_008_F(taint_src: string): void {
  const hot = new Box();
  const clean = new Box();
  hot.info = taint_src;
  taint.Sink(clean.info);
}
