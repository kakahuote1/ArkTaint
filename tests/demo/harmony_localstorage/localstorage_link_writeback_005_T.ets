import { LocalStorageLink, LocalStorageProp, taint } from "./taint_mock";

class Writer005 {
    @LocalStorageLink("token")
    token: string = "";

    write(value: string): void {
        this.token = value;
    }
}

class Reader005 {
    @LocalStorageProp("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

export function localstorage_link_writeback_005_T(taint_src: string): void {
    const writer = new Writer005();
    writer.write(taint_src);

    const reader = new Reader005();
    reader.build();
}

