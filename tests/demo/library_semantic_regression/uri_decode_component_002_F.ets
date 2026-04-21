import { taint } from "./taint_mock";

export function uri_decode_component_002_F(taint_src: string): void {
  const decoded = decodeURIComponent("safe%20component");
  taint.Sink(decoded);
}
