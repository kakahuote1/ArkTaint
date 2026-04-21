import Queue from "@ohos.util.Queue";
import { taint } from "./taint_mock";

export function queue_object_bridge_008_F(taint_src: string): void {
  const hot = { payload: taint_src };
  const clean = { payload: "_" };
  const queue = new Queue<any>();
  queue.add(clean);
  queue.add(hot);
  taint.Sink(queue.getFirst().payload);
}
