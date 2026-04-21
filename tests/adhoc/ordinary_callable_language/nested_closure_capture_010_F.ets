import { taint } from "./taint_mock";

function makeLeak(secret: string): () => void {
  return (): void => {
    taint.Sink(secret);
  };
}

export function nested_closure_capture_010_F(taint_src: string): void {
  const clean = "clean";
  const fp = makeLeak(clean);
  fp();
  void taint_src;
}
