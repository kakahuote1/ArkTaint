import { StorageLink, StorageProp, taint } from "./taint_mock";

class StorageLinkWriter014 {
    @StorageLink("token")
    tokenVal: string = "";

    write(v: string): void {
        this.tokenVal = v;
    }
}

class StoragePropReader014 {
    @StorageProp("token")
    tokenVal: string = "";

    build(): void {
        taint.Sink(this.tokenVal);
    }
}

export function appstorage_decorator_storagelink_writeback_014_T(taint_src: string): void {
    const writer = new StorageLinkWriter014();
    writer.write(taint_src);

    const reader = new StoragePropReader014();
    reader.build();
}
