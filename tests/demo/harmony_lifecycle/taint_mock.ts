export class Want {
    parameters: string = "";
}

export class FormBindingData {
    payload: string = "";
}

export class Router {
    static getParams(): string {
        return "router_payload";
    }
}

export class SystemEnv {
    static getContext(): string {
        return "system_context";
    }
}

export namespace taint {
    export function Sink(data: any): void {
        console.log(data);
    }
}
