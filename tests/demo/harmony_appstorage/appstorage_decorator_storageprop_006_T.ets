import { AppStorage, StorageProp, taint } from "./taint_mock";

class AppStoragePage006 {
    @StorageProp("token")
    tokenVal: string = "";

    build(): void {
        taint.Sink(this.tokenVal);
    }
}

export function appstorage_decorator_storageprop_006_T(taint_src: string): void {
    AppStorage.set("token", taint_src);
    const page = new AppStoragePage006();
    page.build();
}
