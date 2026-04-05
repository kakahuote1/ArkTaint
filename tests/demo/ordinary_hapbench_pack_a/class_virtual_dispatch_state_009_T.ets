import { taint } from "./taint_mock";

abstract class Reader {
  abstract log(): void;
}

class LeakReader extends Reader {
  constructor(private readonly info: string) {
    super();
  }

  log(): void {
    taint.Sink(this.info);
  }
}

class EntryHolder {
  onCreate(): void {
    const taint_src = "secret";
    const reader: Reader = new LeakReader(taint_src);
    reader.log();
  }
}

export function class_virtual_dispatch_state_009_T(): void {
  new EntryHolder().onCreate();
}
