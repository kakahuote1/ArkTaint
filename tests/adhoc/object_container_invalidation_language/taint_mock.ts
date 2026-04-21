export class ArrayList<T> {
    add(_value: T): void {}
    get(_index: number): T { return undefined as T; }
    clear(): void {}
}

export class Queue<T> {
    add(_value: T): void {}
    getFirst(): T { return undefined as T; }
    clear(): void {}
}

export namespace taint {
    export function Sink(value: any): void {
        console.log(value);
    }
}
