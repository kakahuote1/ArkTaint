import { taint } from "./taint_mock";

function makeLeak(secret: string): () => void {
  return (): void => {
    taint.Sink(secret);
  };
}

export function nested_closure_capture_009_T(taint_src: string): void {
  const fp = makeLeak(taint_src);
  fp();
}
