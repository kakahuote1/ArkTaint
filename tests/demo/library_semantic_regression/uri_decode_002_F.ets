import { taint } from "./taint_mock";

export function uri_decode_002_F(taint_src: string): void {
  const decoded = decodeURI("https://safe.example/path");
  taint.Sink(decoded);
}
