import { taint } from "./taint_mock";

export function json_stringify_field_store_004_F(taint_src: string) {
  const payload: any = {};
  payload.phone = "_";
  const serialized = JSON.stringify(payload);
  taint.Sink(serialized);
  void taint_src;
}
