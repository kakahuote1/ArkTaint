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
exports.DotFilePrinter = exports.DotNamespacePrinter = exports.DotClassPrinter = exports.DotMethodPrinter = void 0;
const Printer_1 = require("./Printer");
/**
 * @category save
 */
class DotMethodPrinter extends Printer_1.Printer {
    constructor(method, nesting = false) {
        super();
        this.method = method;
        this.nesting = nesting;
    }
    dump() {
        var _a;
        this.printer.clear();
        if (this.nesting) {
            this.printer.writeIndent().writeLine(`subgraph "cluster_${this.method.getSignature()}" {`);
        }
        else {
            this.printer.writeIndent().writeLine(`digraph "${this.method.getSignature()}" {`);
        }
        this.printer.incIndent();
        this.printer.writeIndent().writeLine(`label="${this.method.getSignature()}";`);
        let blocks = (_a = this.method.getCfg()) === null || _a === void 0 ? void 0 : _a.getBlocks();
        let prefix = `Node${this.stringHashCode(this.method.getSignature().toString())}`;
        this.printBlocks(blocks, prefix);
        this.printer.decIndent();
        this.printer.writeIndent().writeLine('}');
        return this.printer.toString();
    }
    stringHashCode(name) {
        let hashCode = 0;
        for (let i = 0; i < name.length; i++) {
            hashCode += name.charCodeAt(i);
        }
        return Math.abs(hashCode);
    }
    printBlocks(blocks, prefix) {
        if (!blocks) {
            return;
        }
        let blockToNode = new Map();
        let index = 0;
        for (let block of blocks) {
            let name = prefix + index++;
            blockToNode.set(block, name);
            /** Node0 [label="entry"]; */
            this.printer.writeIndent().writeLine(`${name} [label="${this.getBlockContent(block, this.printer.getIndent())}"];`);
        }
        for (let block of blocks) {
            for (let nextBlock of block.getSuccessors()) {
                // Node0 -> Node1;
                this.printer.writeIndent().writeLine(`${blockToNode.get(block)} -> ${blockToNode.get(nextBlock)};`);
            }
            let exceptionalNextBlock = block.getExceptionalSuccessorBlocks();
            if (!exceptionalNextBlock) {
                continue;
            }
            for (const nextBlock of exceptionalNextBlock) {
                this.printer.writeIndent().writeLine(`${blockToNode.get(block)} -> ${blockToNode.get(nextBlock)}[style="dotted"];`);
            }
        }
    }
    getBlockContent(block, indent) {
        let content = [`id:${block.getId()}`];
        for (let stmt of block.getStmts()) {
            content.push(stmt.toString().replace(/"/g, '\\"'));
        }
        return content.join('\n    ' + indent);
    }
}
exports.DotMethodPrinter = DotMethodPrinter;
/**
 * @category save
 */
class DotClassPrinter extends Printer_1.Printer {
    constructor(cls, nesting = false) {
        super();
        this.cls = cls;
        this.nesting = nesting;
    }
    dump() {
        this.printer.clear();
        if (!this.nesting) {
            this.printer.writeLine(`digraph "${this.cls.getName()}" {`);
            this.printer.incIndent();
        }
        for (let method of this.cls.getMethods()) {
            let mtd = new DotMethodPrinter(method, true);
            this.printer.write(mtd.dump());
        }
        if (!this.nesting) {
            this.printer.decIndent();
            this.printer.writeLine(`}`);
        }
        return this.printer.toString();
    }
}
exports.DotClassPrinter = DotClassPrinter;
/**
 * @category save
 */
class DotNamespacePrinter extends Printer_1.Printer {
    constructor(ns, nesting = false) {
        super();
        this.ns = ns;
        this.nesting = nesting;
    }
    dump() {
        this.printer.clear();
        if (!this.nesting) {
            this.printer.writeLine(`digraph "${this.ns.getName()}" {`);
            this.printer.incIndent();
        }
        for (let method of this.ns.getAllMethodsUnderThisNamespace()) {
            let mtd = new DotMethodPrinter(method, true);
            this.printer.write(mtd.dump());
        }
        if (!this.nesting) {
            this.printer.decIndent();
            this.printer.writeLine(`}`);
        }
        return this.printer.toString();
    }
}
exports.DotNamespacePrinter = DotNamespacePrinter;
/**
 * @category save
 */
class DotFilePrinter extends Printer_1.Printer {
    constructor(arkFile) {
        super();
        this.arkFile = arkFile;
    }
    dump() {
        this.printer.clear();
        this.printer.writeLine(`digraph "${this.arkFile.getName()}" {`);
        this.printer.incIndent();
        for (let ns of this.arkFile.getNamespaces()) {
            let nsPrinter = new DotNamespacePrinter(ns, true);
            this.printer.write(nsPrinter.dump());
        }
        // print class
        for (let cls of this.arkFile.getClasses()) {
            let clsPrinter = new DotClassPrinter(cls, true);
            this.printer.write(clsPrinter.dump());
        }
        this.printer.decIndent();
        this.printer.writeLine('}');
        return this.printer.toString();
    }
}
exports.DotFilePrinter = DotFilePrinter;
