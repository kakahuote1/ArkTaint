import { taint } from "./taint_mock";

export function json_stringify_field_store_003_T(taint_src: string) {
  const payload: any = {};
  payload.phone = taint_src;
  const serialized = JSON.stringify(payload);
  taint.Sink(serialized);
}
