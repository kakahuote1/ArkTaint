export class RdbStore {
    insert(_table: string, _row: any): void {}
    query(_sql: string): any { return undefined; }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
