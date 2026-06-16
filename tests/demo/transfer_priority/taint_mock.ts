export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }

    export class PriorityHostExact {
        Bridge(v: any): any {
            return "safe";
        }
    }

    export class PriorityHostConstrained {
        Bridge(v: any): any {
            return "safe";
        }
    }

    export class PriorityHostMethodScoped {
        Bridge(v: any): any {
            return "safe";
        }
    }
}
