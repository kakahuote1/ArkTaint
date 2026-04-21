import { taint } from "./taint_mock";

export function uri_encode_001_T(taint_src: string): void {
  const encoded = encodeURI(taint_src);
  taint.Sink(encoded);
}
