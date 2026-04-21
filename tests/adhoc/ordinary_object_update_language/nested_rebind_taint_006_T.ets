import { taint } from "./taint_mock";

export function nested_rebind_taint_006_T(taint_src: string): void {
  const holder: any = { seed: "safe" };
  const obj: any = { inner: holder };
  obj.inner = { seed: taint_src };
  taint.Sink(obj.inner.seed);
}
