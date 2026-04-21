import { taint } from "./taint_mock";

export function uri_encode_component_001_T(taint_src: string): void {
  const encoded = encodeURIComponent(taint_src);
  taint.Sink(encoded);
}
