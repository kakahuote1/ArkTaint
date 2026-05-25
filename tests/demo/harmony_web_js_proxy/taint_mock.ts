export class Web {
    javaScriptProxy(_options: {
        object: any;
        name: string;
        methodList: string[];
        controller?: any;
    }): Web {
        return this;
    }
}

export namespace taint {
    export function Sink(data: any): void {
        console.log(data);
    }
}
