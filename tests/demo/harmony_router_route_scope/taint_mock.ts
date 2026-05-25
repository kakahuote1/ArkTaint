export class Router {
    static pushUrl(_options: { url: string; params?: any }): void {
    }

    static getParams(): any {
        return {};
    }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
