import { taint } from "./taint_mock";

class SourceRecord {
  name: string = "";
  content: string = "";
}

class TargetRecord {
  name: string = "";
  content: string = "";
}

export function object_literal_field_relay_013_T(taint_src: string) {
  const sourceRecord: SourceRecord = {
    name: "account",
    content: taint_src,
  };

  const targetRecord: TargetRecord = {
    name: sourceRecord.name,
    content: sourceRecord.content,
  };

  taint.Sink(targetRecord.content);
}
