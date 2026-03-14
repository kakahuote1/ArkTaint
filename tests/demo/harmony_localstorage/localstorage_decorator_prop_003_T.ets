import { LocalStorage, LocalStorageProp, taint } from "./taint_mock";

class Reader003 {
    @LocalStorageProp("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

export function localstorage_decorator_prop_003_T(taint_src: string): void {
    LocalStorage.set("token", taint_src);
    const reader = new Reader003();
    reader.build();
}

