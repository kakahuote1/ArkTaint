import { taint } from "./taint_mock";

class InternalAsyncExecutor<T> {
    constructor(executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void) {
        executor(
            (_value: T) => {
            },
            (_reason?: any) => {
            },
        );
    }
}

class Layer4InternalConstructorExecutorPage {
    aboutToAppear(): void {
        new InternalAsyncExecutor<string>((resolve, _reject) => {
            const token = "internal-constructor";
            taint.Sink(token);
            resolve(token);
        });
    }
}

export function layer4_internal_constructor_executor_007_F(): void {
    void Layer4InternalConstructorExecutorPage;
}
