export class Button {
    onClick(_callback: (payload: any) => void): void {}
}

export class FakeButton {
    onClick(_callback: (payload: any) => void): void {}
}

export namespace taint {
    export function Sink(value: any): void {
        void value;
    }
}

