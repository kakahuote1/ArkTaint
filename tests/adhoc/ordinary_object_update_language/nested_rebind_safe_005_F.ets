import { taint } from "./taint_mock";

export function nested_rebind_safe_005_F(taint_src: string): void {
  const holder: any = { seed: taint_src };
  const obj: any = { inner: holder };
  obj.inner = { seed: "safe" };
  taint.Sink(obj.inner.seed);
}
