export class ButtonValue {
    onChange(_callback: (value: string) => void): void {}
}

export namespace taint {
    export function Sink(value: any): void {
        void value;
    }
}
