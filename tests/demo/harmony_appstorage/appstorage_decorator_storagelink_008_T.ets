import { AppStorage, StorageLink, taint } from "./taint_mock";

class AppStoragePage008 {
    @StorageLink("token")
    tokenVal: string = "";

    build(): void {
        taint.Sink(this.tokenVal);
    }
}

export function appstorage_decorator_storagelink_008_T(taint_src: string): void {
    AppStorage.set("token", taint_src);
    const page = new AppStoragePage008();
    page.build();
}
