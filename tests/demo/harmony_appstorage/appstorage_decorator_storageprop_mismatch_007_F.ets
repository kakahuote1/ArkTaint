import { AppStorage, StorageProp, taint } from "./taint_mock";

class AppStoragePage007 {
    @StorageProp("safe")
    safeVal: string = "";

    build(): void {
        taint.Sink(this.safeVal);
    }
}

export function appstorage_decorator_storageprop_mismatch_007_F(taint_src: string): void {
    AppStorage.set("token", taint_src);
    const page = new AppStoragePage007();
    page.build();
}
