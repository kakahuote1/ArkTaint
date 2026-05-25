import { taint } from "./taint_mock";

class JsonResponse {
  data: string = "";
  status: string = "";
}

export function json_stringify_object_literal_007_T(taint_src: string) {
  const response: JsonResponse = {
    data: taint_src,
    status: "ok",
  };
  const serialized = JSON.stringify({
    data: response.data,
    status: response.status,
  });
  taint.Sink(serialized);
}
