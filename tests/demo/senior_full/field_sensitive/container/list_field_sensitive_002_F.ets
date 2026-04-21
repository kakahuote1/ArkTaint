import List from "@ohos.util.List";
import { taint } from "./taint_mock";

/**
 * Introduction List域敏�?
 */
export function list_field_sensitive_002_F(taint_src : string) {
  let l = new List<string>();
  l.add(taint_src);
  l.add("clean");
  taint.Sink(l.get(1));
}
