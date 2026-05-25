export namespace taint {
    export class HttpRequestHost {
        request(url: any): void {
            console.log(url);
        }
    }

    export class AsyncLockHost {
        request(key: any): void {
            console.log(key);
        }
    }
}
