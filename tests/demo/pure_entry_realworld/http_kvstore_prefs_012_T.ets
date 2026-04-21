// Case: HTTP request chain with callback and KVStore data listener
// Real pattern: fetch data -> cache in KVStore -> listen for changes
import { createHttp, KVStore, Preferences, taint } from "./taint_mock";

class DataSyncManager {
    private kvStore: KVStore;
    private prefs: Preferences;

    constructor() {
        this.kvStore = new KVStore();
        this.prefs = new Preferences();
    }

    build(): void {
        // HTTP request with callback
        const http = createHttp();
        http.request("https://api.smarthome.local/devices", (err: any, data: any) => {
            if (err) {
                taint.Sink(err);
                return;
            }
            taint.Sink(data);
            this.kvStore.put("device_list", data);
        });

        // KVStore change listener
        this.kvStore.on("dataChange", (changeData: any) => {
            taint.Sink(changeData);
            this.updateUI(changeData);
        });

        // Preferences async read
        this.prefs.get("last_sync_time", "", (err: any, value: any) => {
            if (err) {
                taint.Sink(err);
                return;
            }
            taint.Sink(value);
        });

        // Preferences async write
        this.prefs.put("last_sync_time", Date.now().toString(), (err: any) => {
            if (err) taint.Sink(err);
        });
    }

    private updateUI(data: any): void {
        taint.Sink(data);
    }
}

export { DataSyncManager };
