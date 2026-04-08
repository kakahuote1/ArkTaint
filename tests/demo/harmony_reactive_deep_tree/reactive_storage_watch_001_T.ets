import { AppStorage, State, Watch, taint } from "./taint_mock";

class StorageWatchPage001 {
    @State token: string = "";

    build(): void {
        AppStorage.setOrCreate("token", taint.Source());
        this.token = AppStorage.get("token");
    }

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink(this.token);
    }
}

export function reactive_storage_watch_001_T(): void {
    void StorageWatchPage001;
}
