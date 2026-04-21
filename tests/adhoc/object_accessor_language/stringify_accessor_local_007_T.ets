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

export function stringify_accessor_local_007_T(seed: object): void {
    const user = new User();
    const info = JSON.stringify(seed);
    user.setInfo(info);
    taint.Sink(user.getInfo());
}
