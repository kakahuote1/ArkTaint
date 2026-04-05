import { taint } from "./taint_mock";

export function array_object_bridge_001_T(taint_src: string): void {
  const hot = { payload: taint_src };
  const clean = { payload: "_" };
  const arr: any[] = [];
  arr[0] = hot;
  arr[1] = clean;
  taint.Sink(arr[0].payload);
}
