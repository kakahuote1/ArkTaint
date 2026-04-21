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

class CleanReader extends Reader {
  log(): void {
    taint.Sink("clean");
  }
}

class EntryHolder {
  onCreate(): void {
    const taint_src = "secret";
    const reader: Reader = new CleanReader();
    reader.log();
    void taint_src;
    void LeakReader;
  }
}

export function class_virtual_dispatch_state_010_F(): void {
  new EntryHolder().onCreate();
}
