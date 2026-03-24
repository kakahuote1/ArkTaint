/// <reference types="node" />
import fs from 'fs';
export declare class ArkCodeBuffer {
    output: string[];
    indent: string;
    constructor(indent?: string);
    write(s: string): this;
    writeLine(s: string): this;
    writeSpace(s: string): this;
    writeStringLiteral(s: string): this;
    writeIndent(): this;
    incIndent(): this;
    decIndent(): this;
    getIndent(): string;
    toString(): string;
    clear(): void;
}
export declare class ArkStream extends ArkCodeBuffer {
    streamOut: fs.WriteStream;
    constructor(streamOut: fs.WriteStream);
    write(s: string): this;
    close(): void;
}
//# sourceMappingURL=ArkStream.d.ts.map