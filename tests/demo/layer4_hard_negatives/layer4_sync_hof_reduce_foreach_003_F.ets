import { taint } from "./taint_mock";

class SyncList<T> {
    reduce<R>(_reducer: (acc: R, item: T) => R, initial: R): R {
        return initial;
    }

    forEach(_visitor: (item: T) => void): void {}
}

class Layer4ReduceForeachPage {
    build(): void {
        const list = new SyncList<number>();
        list.forEach((item) => {
            taint.Sink(item);
        });
        void list.reduce((acc, item) => acc + item, 0);
    }
}

export function layer4_sync_hof_reduce_foreach_003_F(): void {
    void Layer4ReduceForeachPage;
}
