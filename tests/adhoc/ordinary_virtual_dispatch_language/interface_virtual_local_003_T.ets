import { taint } from "./taint_mock";

interface Reader {
  read(v: string): string;
}

class LeakReader implements Reader {
  read(v: string): string {
    return v;
  }
}

export function interface_virtual_local_003_T(taint_src: string) {
  const reader: Reader = new LeakReader();
  taint.Sink(reader.read(taint_src));
}
