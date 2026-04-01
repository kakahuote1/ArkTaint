import { taint } from "./taint_mock";

abstract class Reader {
  abstract read(v: string): string;
}

class CleanReader extends Reader {
  read(_v: string): string {
    return "_";
  }
}

export function base_virtual_local_002_F(taint_src: string) {
  const reader: Reader = new CleanReader();
  taint.Sink(reader.read(taint_src));
}
