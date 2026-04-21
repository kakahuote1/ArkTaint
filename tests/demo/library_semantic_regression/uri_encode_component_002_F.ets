import { taint } from "./taint_mock";

export function uri_encode_component_002_F(taint_src: string): void {
  const encoded = encodeURIComponent("safe component");
  taint.Sink(encoded);
}
