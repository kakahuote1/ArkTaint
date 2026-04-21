export class JsonCodec {
    stringify(value: any): string {
        return JSON.stringify(value);
    }

    parse(text: string): any {
        return JSON.parse(text);
    }
}
