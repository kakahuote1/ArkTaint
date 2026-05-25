export interface P2pMessage {
    content: string;
}

export class P2pClient {
    registerMessageReceiver(_deviceId: string, _appParam: object, _callback: (msg: P2pMessage) => void): void {}
    sendMessage(_deviceId: string, _appParam: object, _message: P2pMessage): void {}
}

export class TextDecoder {
    decodeToString(_input: string, _options: object): string {
        return "";
    }
}

export class TextEncoder {
    encodeInto(_input: string): string {
        return "";
    }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
