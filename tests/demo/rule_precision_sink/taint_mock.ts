export namespace taint {
    export function SourceReturn(v: any): any {
        return v;
    }

    export function SinkArg0(a: any, b: any): void {
        console.log(a, b);
    }

    export function SinkArg1(a: any, b: any): void {
        console.log(a, b);
    }

    export function SinkMulti(a: any, b: any): void {
        console.log(a, b);
    }

    export function SinkField(box: any): void {
        console.log(box);
    }

    export function SinkInvokeKind(a: any): void {
        console.log(a);
    }

    export class InvokeKindHost {
        SinkInvokeKind(a: any): void {
            console.log(a);
        }
    }

    export function SinkArgCount(a: any, b?: any): void {
        console.log(a, b);
    }

    export class TypeHintHostTarget {
        SinkTypeHint(a: any): void {
            console.log(a);
        }
    }

    export class TypeHintHostOther {
        SinkTypeHint(a: any): void {
            console.log(a);
        }
    }

    export class RdbStore {
        update(values: any, predicates: any, callback: any): void {
            console.log(values, predicates, callback);
        }
    }

    export class RdbStoreUtil {
        static update(values: any, predicates: any, callback: any): void {
            console.log(values, predicates, callback);
        }
    }
}
