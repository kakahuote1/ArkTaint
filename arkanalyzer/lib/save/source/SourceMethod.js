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
exports.SourceMethod = void 0;
const Type_1 = require("../../core/base/Type");
const ArkStream_1 = require("../ArkStream");
const SourceBase_1 = require("./SourceBase");
const SourceBody_1 = require("./SourceBody");
const SourceTransformer_1 = require("./SourceTransformer");
const PrinterUtils_1 = require("../base/PrinterUtils");
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const Position_1 = require("../../core/base/Position");
const Const_1 = require("../../core/common/Const");
/**
 * @category save
 */
class SourceMethod extends SourceBase_1.SourceBase {
    constructor(method, indent = '') {
        super(method.getDeclaringArkFile(), indent);
        this.method = method;
        this.transformer = new SourceTransformer_1.SourceTransformer(this);
        this.inBuilder = this.initInBuilder();
    }
    getDeclaringArkNamespace() {
        return this.method.getDeclaringArkClass().getDeclaringArkNamespace();
    }
    setInBuilder(inBuilder) {
        this.inBuilder = inBuilder;
    }
    dump() {
        this.printer.clear();
        const commentsMetadata = this.method.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            const comments = commentsMetadata.getComments();
            comments.forEach(comment => {
                this.printer.writeIndent().writeLine(comment.content);
            });
        }
        if (!this.method.isDefaultArkMethod()) {
            this.printMethod(this.method);
        }
        else {
            this.printBody(this.method);
        }
        return this.printer.toString();
    }
    getLine() {
        let line = this.method.getLine();
        if (line === null && this.method.getDeclareLineCols()) {
            line = (0, Position_1.getLineNo)(this.method.getDeclareLineCols()[0]);
        }
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
    dumpDefaultMethod() {
        let srcBody = new SourceBody_1.SourceBody(this.printer.getIndent(), this.method, false);
        return srcBody.getStmts();
    }
    printMethod(method) {
        this.printDecorator(method.getDecorators());
        let implementationSig = method.getImplementationSignature();
        if (this.method.getDeclareSignatures()) {
            for (const methodSig of this.method.getDeclareSignatures()) {
                this.printer.writeIndent().writeLine(`${this.methodProtoToString(methodSig)};`);
            }
        }
        if (!implementationSig) {
            return;
        }
        this.printer.writeIndent().write(this.methodProtoToString(implementationSig));
        // abstract function no body
        if (SourceMethod.getPrinterOptions().noMethodBody) {
            this.printer.writeIndent().writeLine(`;`);
            return;
        }
        this.printer.writeLine(' {');
        this.printer.incIndent();
        this.printBody(method);
        this.printer.decIndent();
        this.printer.writeIndent();
        if (PrinterUtils_1.PrinterUtils.isAnonymousMethod(method.getName())) {
            this.printer.write('}');
        }
        else {
            this.printer.writeLine('}');
        }
    }
    printBody(method) {
        let srcBody = new SourceBody_1.SourceBody(this.printer.getIndent(), method, this.inBuilder);
        this.printer.write(srcBody.dump());
    }
    methodProtoToString(methodSig) {
        var _a;
        let code = new ArkStream_1.ArkCodeBuffer();
        code.writeSpace(this.modifiersToString(this.method.getModifiers()));
        if (!PrinterUtils_1.PrinterUtils.isAnonymousMethod(methodSig.getMethodSubSignature().getMethodName())) {
            if ((_a = this.method.getDeclaringArkClass()) === null || _a === void 0 ? void 0 : _a.isDefaultArkClass()) {
                code.writeSpace('function');
            }
            if (this.method.getAsteriskToken()) {
                code.writeSpace('*');
            }
            code.write(this.resolveMethodName(methodSig.getMethodSubSignature().getMethodName()));
        }
        const genericTypes = this.method.getGenericTypes();
        if (genericTypes && genericTypes.length > 0) {
            code.write(`<${this.transformer.typeArrayToString(genericTypes)}>`);
        }
        let parameters = [];
        methodSig
            .getMethodSubSignature()
            .getParameters()
            .forEach(parameter => {
            let str = parameter.getName();
            if (parameter.isRest()) {
                str = `...${parameter.getName()}`;
            }
            if (parameter.isOptional()) {
                str += '?';
            }
            if (parameter.getType()) {
                str += ': ' + this.transformer.typeToString(parameter.getType());
            }
            if (!str.startsWith(Const_1.LEXICAL_ENV_NAME_PREFIX)) {
                parameters.push(str);
            }
        });
        code.write(`(${parameters.join(', ')})`);
        const returnType = methodSig.getMethodSubSignature().getReturnType();
        if (methodSig.getMethodSubSignature().getMethodName() !== 'constructor' && !(returnType instanceof Type_1.UnknownType)) {
            code.write(`: ${this.transformer.typeToString(returnType)}`);
        }
        if (PrinterUtils_1.PrinterUtils.isAnonymousMethod(methodSig.getMethodSubSignature().getMethodName())) {
            code.write(' =>');
        }
        return code.toString();
    }
    toArrowFunctionTypeString() {
        let code = new ArkStream_1.ArkCodeBuffer();
        let parameters = [];
        this.method.getParameters().forEach(parameter => {
            let str = parameter.getName();
            if (parameter.isOptional()) {
                str += '?';
            }
            if (parameter.getType()) {
                str += ': ' + this.transformer.typeToString(parameter.getType());
            }
            parameters.push(str);
        });
        code.write(`(${parameters.join(', ')}) => `);
        const returnType = this.method.getReturnType();
        if (!(returnType instanceof Type_1.UnknownType)) {
            code.writeSpace(`${this.transformer.typeToString(returnType)}`);
        }
        return code.toString();
    }
    initInBuilder() {
        return (this.method.hasBuilderDecorator() ||
            ((this.method.getName() === 'build' || this.method.getName() === 'pageTransition') &&
                !this.method.isStatic() &&
                this.method.getDeclaringArkClass().hasViewTree()));
    }
}
exports.SourceMethod = SourceMethod;
