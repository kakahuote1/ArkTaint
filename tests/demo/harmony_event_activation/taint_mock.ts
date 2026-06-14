export class UIInput {
    onChange(_cb: (value: string) => void): void {}
    onInput(_cb: (value: string) => void): void {}
    onSubmit(_cb: (enterKey: string, event: SubmitEventLike) => void): void {}
    onClick(_cb: (event: string) => void): void {}
    onChange2(_cb: (first: string, second: string) => void): void {}
}

export interface SubmitEventLike {
    text: string;
}

export class Tabs {
    onChange(_cb: (index: number) => void): void {}
}

export class Button {
    onClick(_cb: () => void): void {}
}

export class Search {
    onChange(_cb: (value: string) => void): void {}
    onSubmit(_cb: (value: string) => void): void {}
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

export function cbTextInputOnSubmitEventText(_enterKey: string, event: SubmitEventLike): void {
    taint.Sink(event.text);
}

export function cbTextInputOnSubmitEnterKey(enterKey: string, _event: SubmitEventLike): void {
    taint.Sink(enterKey);
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
