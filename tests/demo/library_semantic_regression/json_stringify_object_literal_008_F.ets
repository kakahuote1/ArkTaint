import { taint } from "./taint_mock";

class JsonResponse {
  data: string = "";
  status: string = "";
}

export function json_stringify_object_literal_008_F(taint_src: string) {
  const response: JsonResponse = {
    data: "clean",
    status: "ok",
  };
  const serialized = JSON.stringify({
    data: response.data,
    status: response.status,
  });
  taint.Sink(serialized);
}
