export class Button {
    onClick(_callback: () => void): void {}
}

export namespace taint {
    export function Sink(value: any): void {
        void value;
    }
}
