// Case: DataShareExtensionAbility acting as a data provider
// Real pattern: exposing device data to other apps via DataShare
import { DataShareExtensionAbility, taint } from "./taint_mock";

export default class DeviceDataProvider extends DataShareExtensionAbility {
    private dataStore: Map<string, any> = new Map();

    onCreate(want: any): void {
        taint.Sink(want);
        this.dataStore.set("devices", []);
    }

    insert(uri: string, value: any): number {
        taint.Sink(uri);
        taint.Sink(value);
        const key = this.extractKey(uri);
        this.dataStore.set(key, value);
        return 1;
    }

    query(uri: string, predicates: any, columns: string[]): any {
        taint.Sink(uri);
        taint.Sink(predicates);
        const key = this.extractKey(uri);
        return this.dataStore.get(key);
    }

    update(uri: string, predicates: any, value: any): number {
        taint.Sink(uri);
        taint.Sink(value);
        const key = this.extractKey(uri);
        this.dataStore.set(key, value);
        return 1;
    }

    delete(uri: string, predicates: any): number {
        taint.Sink(uri);
        taint.Sink(predicates);
        const key = this.extractKey(uri);
        this.dataStore.delete(key);
        return 1;
    }

    private extractKey(uri: string): string {
        return uri.split("/").pop() || "";
    }
}
