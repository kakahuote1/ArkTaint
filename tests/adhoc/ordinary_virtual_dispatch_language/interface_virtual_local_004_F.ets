import { taint } from "./taint_mock";

interface Reader {
  read(v: string): string;
}

class CleanReader implements Reader {
  read(_v: string): string {
    return "_";
  }
}

export function interface_virtual_local_004_F(taint_src: string) {
  const reader: Reader = new CleanReader();
  taint.Sink(reader.read(taint_src));
}
