import { taint } from "./taint_mock";

class User {
    private info: string = "";
    private other: string = "safe";

    setInfo(next: string): void {
        this.info = next;
    }

    getInfo(): string {
        return this.info;
    }

    getOther(): string {
        return this.other;
    }
}

export function local_accessor_same_method_001_T(): void {
    const user = new User();
    const taint_src = taint.Source();
    user.setInfo(taint_src);
    taint.Sink(user.getInfo());
}
