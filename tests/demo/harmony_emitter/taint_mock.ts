export class Emitter {
    on(_event: string, _cb: (data: any) => void): void {}
    emit(_event: string, _data: any): void {}
}

export class EventHub {
    on(_event: string, _cb: (data: any) => void): void {}
    emit(_event: string, _data: any): void {}
}

export class UIContext {
    eventHub: EventHub = new EventHub();
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}

