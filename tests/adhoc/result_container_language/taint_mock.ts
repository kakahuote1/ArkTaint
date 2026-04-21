export class ResultSet {
    getString(_column: string): any { return undefined; }
    getLong(_column: string): any { return undefined; }
    getRows(): any { return undefined; }
}

export class DataShareResultSet {
    getString(_column: string): any { return undefined; }
    getRows(): any { return undefined; }
}

export class RdbStore {
    token?: string;
    token_alt?: string;

    query(_sql: string): ResultSet { return new ResultSet(); }
    querySql(_sql: string): ResultSet { return new ResultSet(); }
}

export class DataShareHelper {
    token?: string;
    token_alt?: string;

    querySync(_uri: string): DataShareResultSet { return new DataShareResultSet(); }
    querySqlSync(_sql: string): DataShareResultSet { return new DataShareResultSet(); }
}

export namespace taint {
    export function Sink(value: any): void {
        console.log(value);
    }
}
