import { LocalStorage, LocalStorageProp, taint } from "./taint_mock";

class Reader004 {
    @LocalStorageProp("safe")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

export function localstorage_decorator_prop_004_F(taint_src: string): void {
    LocalStorage.set("token", taint_src);
    const reader = new Reader004();
    reader.build();
}

