export namespace MySpace {

    export type Constructor<T> = {
        new(): T;
    }

    export function funcTarget() {
        console.log('funcTarget');
    }

    export class ClassTarget {
        public fieldA = '111';
        public static staticField = 123;

        public methodTarget() {
            let a = this.fieldA;
        }

        public static staticFunc() {
            let b = ClassTarget.staticField;
            console.log('123');
        }

        public funcTarget() {
            console.log('ClassTarget.funcTarget')
        }
    }
}

export class ClassTarget {
    public fieldA = '1111';
    public static staticField = 1234;

    public methodTarget() {
        let a = this.fieldA;
    }

    public static staticFunc() {
        let b = ClassTarget.staticField;
        console.log('1234');
    }

    public funcTarget() {
        console.log('ClassTarget.funcTargetC')
    }
}

export type TypeTarget = string | number;