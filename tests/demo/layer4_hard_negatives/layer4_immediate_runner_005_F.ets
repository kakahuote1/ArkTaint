import { taint } from "./taint_mock";

class ImmediateRunner {
    run<T>(job: () => T): T {
        return job();
    }
}

class Layer4ImmediateRunnerPage {
    build(): void {
        const runner = new ImmediateRunner();
        const result = runner.run(() => {
            const token = "runner-token";
            taint.Sink(token);
            return token;
        });
        void result;
    }
}

export function layer4_immediate_runner_005_F(): void {
    void Layer4ImmediateRunnerPage;
}
