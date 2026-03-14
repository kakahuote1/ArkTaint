import { MySpace, TypeTarget } from './Target';

type TestType = MySpace.Constructor<MySpace.ClassTarget>;

export function funcB() {
    MySpace.funcTarget();
}

export class ClassB extends MySpace.ClassTarget {
    private field1: TypeTarget = 1;
    public methodB() {
        let b = new MySpace.ClassTarget();
        b.methodTarget();
        let d = b.funcTarget();
    }
}