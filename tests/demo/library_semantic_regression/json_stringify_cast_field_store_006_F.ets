import { taint } from "./taint_mock";

class JsonStringifyCleanPayload {
  phone: string = "";
}

export function json_stringify_cast_field_store_006_F(taint_src: string) {
  let payload: JsonStringifyCleanPayload = {} as JsonStringifyCleanPayload;
  payload.phone = "clean";
  const serialized = JSON.stringify(payload);
  taint.Sink(serialized);
  void taint_src;
}
