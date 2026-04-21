import { taint } from "./taint_mock";

export function uri_encode_002_F(taint_src: string): void {
  const encoded = encodeURI("https://safe.example/path");
  taint.Sink(encoded);
}
