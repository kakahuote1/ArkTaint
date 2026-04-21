export class CrossFileUserModel {
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
