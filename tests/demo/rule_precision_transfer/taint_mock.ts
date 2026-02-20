export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }

    export function BridgeInvokeKind(v: any): any {
        return "safe";
    }

    export class InvokeKindHost {
        BridgeInvokeKind(v: any): any {
            return "safe";
        }
    }

    export function BridgeArgCount(a: any, b?: any): any {
        return "safe";
    }

    export class TransferTypeHostTarget {
        BridgeTypeHint(v: any): any {
            return "safe";
        }
    }

    export class TransferTypeHostOther {
        BridgeTypeHint(v: any): any {
            return "safe";
        }
    }

    export class ScopeHostAllowed {
        BridgeScope(v: any): any {
            return "safe";
        }
    }

    export class ScopeHostBlocked {
        BridgeScope(v: any): any {
            return "safe";
        }
    }

    export class ComposeBox {
        Pipe(v: any): any {
            return "safe";
        }
    }
}
