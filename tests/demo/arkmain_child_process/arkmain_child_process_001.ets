import { ChildProcess, ChildProcessArgs } from "./taint_mock";

class DemoChildProcess extends ChildProcess {
    onStart(args?: ChildProcessArgs): void {
        void args;
        console.info("child process started");
    }
}

class PlainOnStartCarrier {
    onStart(args?: ChildProcessArgs): void {
        void args;
        console.info("not a child process entry");
    }
}

export function arkmain_child_process_001(): void {
    new DemoChildProcess().onStart({});
    new PlainOnStartCarrier().onStart({});
}
