import { taint } from "./taint_mock";

export function uri_decode_component_001_T(taint_src: string): void {
  const decoded = decodeURIComponent(taint_src);
  taint.Sink(decoded);
}
