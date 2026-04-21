import { taint } from "./taint_mock";

abstract class Reader {
  abstract read(v: string): string;
}

class LeakReader extends Reader {
  read(v: string): string {
    return v;
  }
}

export function base_virtual_local_001_T(taint_src: string) {
  const reader: Reader = new LeakReader();
  taint.Sink(reader.read(taint_src));
}
