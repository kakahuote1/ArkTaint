"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkStream = exports.ArkCodeBuffer = void 0;
class ArkCodeBuffer {
    constructor(indent = '') {
        this.output = [];
        this.indent = '';
        this.indent = indent;
    }
    write(s) {
        this.output.push(s);
        return this;
    }
    writeLine(s) {
        this.write(s);
        this.write('\n');
        return this;
    }
    writeSpace(s) {
        if (s.length === 0) {
            return this;
        }
        this.write(s);
        this.write(' ');
        return this;
    }
    writeStringLiteral(s) {
        this.write(`'${s}'`);
        return this;
    }
    writeIndent() {
        this.write(this.indent);
        return this;
    }
    incIndent() {
        this.indent += '  ';
        return this;
    }
    decIndent() {
        if (this.indent.length >= 2) {
            this.indent = this.indent.substring(0, this.indent.length - 2);
        }
        return this;
    }
    getIndent() {
        return this.indent;
    }
    toString() {
        return this.output.join('');
    }
    clear() {
        this.output = [];
    }
}
exports.ArkCodeBuffer = ArkCodeBuffer;
class ArkStream extends ArkCodeBuffer {
    constructor(streamOut) {
        super('');
        this.streamOut = streamOut;
    }
    write(s) {
        this.streamOut.write(s);
        return this;
    }
    close() {
        this.streamOut.close();
    }
}
exports.ArkStream = ArkStream;
