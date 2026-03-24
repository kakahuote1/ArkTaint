import { taint } from "./taint_mock";

class SyncList<T> {
    sort(_compare: (left: T, right: T) => number): T[] {
        return [];
    }
}

class Layer4SortPage {
    build(): void {
        const list = new SyncList<number>();
        list.sort((left, right) => {
            taint.Sink(left);
            return left - right;
        });
    }
}

export function layer4_sync_hof_sort_001_F(): void {
    void Layer4SortPage;
}
