export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }

    export class ConflictAllowed {
        BridgeSame(v: any): any {
            return "safe";
        }
    }

    export class ConflictBlocked {
        BridgeSame(v: any): any {
            return "safe";
        }
    }

    export class ConflictStaticAllowed {
        static BridgeSame(v: any): any {
            return "safe";
        }
    }

    export class ConflictStaticBlocked {
        static BridgeSame(v: any): any {
            return "safe";
        }
    }

    export class ConflictArity {
        static BridgeArity(a: any, b?: any): any {
            return "safe";
        }
    }
}
