export class UIInput {
    onChange(cb: (value: string) => void): void {
        cb("");
    }

    onInput(cb: (value: string) => void): void {
        cb("");
    }

    onSubmit(cb: (enterKey: string, event: SubmitEventLike) => void): void {
        cb("", { text: "" });
    }

    onClick(cb: (event: string) => void): void {
        cb("");
    }

    onChange2(cb: (first: string, second: string) => void): void {
        cb("", "");
    }
}

export interface SubmitEventLike {
    text: string;
}

export class Tabs {
    onChange(cb: (index: number) => void): void {
        cb(0);
    }
}

export class Button {
    onClick(cb: () => void): void {
        cb();
    }
}

export class Search {
    onChange(cb: (value: string) => void): void {
        cb("");
    }

    onSubmit(cb: (value: string) => void): void {
        cb("");
    }
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
