import { StorageLink, StorageProp, taint } from "./taint_mock";

class StorageLinkWriter015 {
    @StorageLink("token")
    tokenVal: string = "";

    write(v: string): void {
        this.tokenVal = v;
    }
}

class StoragePropReader015 {
    @StorageProp("token")
    tokenVal: string = "";

    build(): void {
        taint.Sink(this.tokenVal);
    }
}

export function appstorage_decorator_storagelink_writeback_015_F(taint_src: string): void {
    const writer = new StorageLinkWriter015();
    writer.write("safe_literal");

    const reader = new StoragePropReader015();
    reader.build();

    const _unused = taint_src;
    void _unused;
}
