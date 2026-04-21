import { taint } from "./taint_mock";

class SyncList<T> {
    filter(_predicate: (item: T) => boolean): T[] {
        return [];
    }

    map<R>(_mapper: (item: T) => R): R[] {
        return [];
    }
}

class Layer4FilterMapPage {
    build(): void {
        const list = new SyncList<number>();
        const filtered = list.filter((item) => {
            taint.Sink(item);
            return item > 0;
        });
        void filtered.map((item) => item.toString());
    }
}

export function layer4_sync_hof_filter_map_002_F(): void {
    void Layer4FilterMapPage;
}
