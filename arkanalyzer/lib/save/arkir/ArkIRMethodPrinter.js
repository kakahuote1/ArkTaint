"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
exports.ArkIRMethodPrinter = void 0;
const ArkStream_1 = require("../ArkStream");
const Stmt_1 = require("../../core/base/Stmt");
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const BasePrinter_1 = require("../base/BasePrinter");
/**
 * @category save
 */
class ArkIRMethodPrinter extends BasePrinter_1.BasePrinter {
    constructor(method, indent = '') {
        super(indent);
        this.method = method;
    }
    dump() {
        this.printer.clear();
        const commentsMetadata = this.method.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            this.printComments(commentsMetadata);
        }
        this.printMethod(this.method);
        return this.printer.toString();
    }
    getLine() {
        let line = this.method.getLine();
        if (line === null) {
            line = 0;
        }
        if (line > 0) {
            return line;
        }
        const stmts = [];
        const cfg = this.method.getCfg();
        if (cfg) {
            cfg.getStmts()
                .reverse()
                .forEach(stmt => stmts.push(stmt));
        }
        for (const stmt of stmts) {
            if (stmt.getOriginPositionInfo().getLineNo() > 0) {
                return stmt.getOriginPositionInfo().getLineNo();
            }
        }
        return line;
    }
    printMethod(method) {
        this.printDecorator(method.getDecorators());
        this.printer.writeIndent().write(this.methodProtoToString(method));
        // abstract function no body
        if (!method.getBody()) {
            this.printer.writeLine('');
            return;
        }
        this.printer.writeLine(' {');
        this.printer.incIndent();
        this.printBody(method);
        this.printer.decIndent();
        this.printer.writeIndent().writeLine('}');
    }
    printBody(method) {
        if (method.getCfg()) {
            this.printCfg(method.getCfg());
        }
    }
    methodProtoToString(method) {
        let code = new ArkStream_1.ArkCodeBuffer();
        code.writeSpace(this.modifiersToString(method.getModifiers()));
        if (method.getAsteriskToken()) {
            code.writeSpace('*');
        }
        code.write(this.resolveMethodName(method.getName()));
        const genericTypes = method.getGenericTypes();
        if (genericTypes && genericTypes.length > 0) {
            let typeParameters = [];
            genericTypes.forEach(genericType => {
                typeParameters.push(genericType.toString());
            });
            code.write(`<${genericTypes.join(', ')}>`);
        }
        let parameters = [];
        method.getParameters().forEach(parameter => {
            let str = parameter.getName();
            if (parameter.isRest()) {
                str = `...${parameter.getName()}`;
            }
            if (parameter.isOptional()) {
                str += '?';
            }
            if (parameter.getType()) {
                str += ': ' + parameter.getType().toString();
            }
            parameters.push(str);
        });
        code.write(`(${parameters.join(', ')})`);
        const returnType = method.getReturnType();
        code.write(`: ${returnType.toString()}`);
        return code.toString();
    }
    printCfg(cfg) {
        let isFirstBB = true;
        for (const block of cfg.getBlocks()) {
            if (!isFirstBB) {
                this.printer.writeLine('');
            }
            this.printBasicBlock(block);
            isFirstBB = false;
        }
    }
    printBasicBlock(block) {
        let successors = block.getSuccessors();
        this.printer.writeIndent().writeLine(`label${block.getId()}:`);
        this.printer.incIndent();
        if (successors.length === 1) {
            block.getStmts().map(stmt => {
                this.printer.writeIndent().writeLine(stmt.toString());
            });
            this.printer.writeIndent().writeLine(`goto label${successors[0].getId()}`);
        }
        else if (successors.length === 2) {
            for (const stmt of block.getStmts()) {
                if (stmt instanceof Stmt_1.ArkIfStmt) {
                    this.printer.writeIndent().writeLine(`${stmt.toString()} goto label${successors[0].getId()} label${successors[1].getId()}`);
                }
                else {
                    this.printer.writeIndent().writeLine(stmt.toString());
                }
            }
        }
        else {
            block.getStmts().map(stmt => {
                this.printer.writeIndent().writeLine(stmt.toString());
            });
        }
        this.printer.decIndent();
    }
}
exports.ArkIRMethodPrinter = ArkIRMethodPrinter;
