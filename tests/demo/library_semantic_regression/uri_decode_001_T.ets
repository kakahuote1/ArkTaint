import { taint } from "./taint_mock";

export function uri_decode_001_T(taint_src: string): void {
  const decoded = decodeURI(taint_src);
  taint.Sink(decoded);
}
