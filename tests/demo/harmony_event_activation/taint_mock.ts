export class UIInput {
    onChange(_cb: (value: string) => void): void {}
    onInput(_cb: (value: string) => void): void {}
    onSubmit(_cb: (value: string) => void): void {}
    onClick(_cb: (event: string) => void): void {}
    onChange2(_cb: (first: string, second: string) => void): void {}
}

export namespace taint {
    export function Sink(data: any): void {
        console.log(data);
    }
}

export function cbOnChange(value: string): void {
    taint.Sink(value);
}

export function cbOnInput(value: string): void {
    taint.Sink(value);
}

export function cbOnSubmit(value: string): void {
    taint.Sink(value);
}

export function cbOnClick(event: string): void {
    taint.Sink(event);
}

export function cbOnChangeSecond(first: string, second: string): void {
    taint.Sink(second);
}

export function cbOnChangeFirst(first: string, second: string): void {
    taint.Sink(first);
}
