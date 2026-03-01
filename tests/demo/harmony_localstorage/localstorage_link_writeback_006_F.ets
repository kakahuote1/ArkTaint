import { LocalStorageLink, LocalStorageProp, taint } from "./taint_mock";

class Writer006 {
    @LocalStorageLink("token")
    token: string = "";

    write(value: string): void {
        this.token = value;
    }
}

class Reader006 {
    @LocalStorageProp("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

export function localstorage_link_writeback_006_F(taint_src: string): void {
    const writer = new Writer006();
    writer.write("safe");
    const _keepLive = taint_src;

    const reader = new Reader006();
    reader.build();
}
