import { taint } from "./taint_mock";

class JsonStringifyPayload {
  phone: string = "";
}

export function json_stringify_cast_field_store_005_T(taint_src: string) {
  let payload: JsonStringifyPayload = {} as JsonStringifyPayload;
  payload.phone = taint_src;
  const serialized = JSON.stringify(payload);
  taint.Sink(serialized);
}
