import { taint } from "./taint_mock";

class ToastOptions {
  message: string = "";
}

class SourceRecord {
  password: string = "";
}

export function object_literal_conditional_value_016_T(taint_src: string) {
  const sourceRecord: SourceRecord = {
    password: taint_src,
  };

  const options: ToastOptions = {
    message: sourceRecord.password,
  };

  taint.Sink(options.message);
}
