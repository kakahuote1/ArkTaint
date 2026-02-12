import Queue from "@ohos.util.Queue";
import { taint } from "./taint_mock";

/**
 * Introduction Queue域敏�?
 */
export function queue_field_sensitive_002_F(taint_src : string) {
  let s = new Queue<string>();
  s.add("clean");
  s.add(taint_src);
  taint.Sink(s.getFirst());
}
