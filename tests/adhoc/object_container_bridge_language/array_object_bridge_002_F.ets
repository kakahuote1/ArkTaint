import { taint } from "./taint_mock";

export function array_object_bridge_002_F(taint_src: string): void {
  const hot = { payload: taint_src };
  const clean = { payload: "_" };
  const hotArr: any[] = [];
  hotArr[0] = hot;
  const cleanArr: any[] = [];
  cleanArr[0] = clean;
  taint.Sink(cleanArr[0].payload);
}
