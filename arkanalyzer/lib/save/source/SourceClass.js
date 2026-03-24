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
exports.SourceDefaultClass = exports.SourceClass = void 0;
const ArkClass_1 = require("../../core/model/ArkClass");
const SourceBase_1 = require("./SourceBase");
const SourceBody_1 = require("./SourceBody");
const SourceField_1 = require("./SourceField");
const SourceMethod_1 = require("./SourceMethod");
const SourceTransformer_1 = require("./SourceTransformer");
const PrinterUtils_1 = require("../base/PrinterUtils");
const Const_1 = require("../../core/common/Const");
const ArkField_1 = require("../../core/model/ArkField");
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
/**
 * @category save
 */
class SourceClass extends SourceBase_1.SourceBase {
    constructor(cls, indent = '') {
        super(cls.getDeclaringArkFile(), indent);
        this.cls = cls;
        this.transformer = new SourceTransformer_1.SourceTransformer(this);
    }
    getDeclaringArkNamespace() {
        return this.cls.getDeclaringArkNamespace();
    }
    getLine() {
        return this.cls.getLine();
    }
    dump() {
        this.printer.clear();
        if (this.cls.getCategory() === ArkClass_1.ClassCategory.OBJECT) {
            return this.dumpObject();
        }
        if (this.cls.getCategory() === ArkClass_1.ClassCategory.TYPE_LITERAL) {
            return this.dumpTypeLiteral();
        }
        const commentsMetadata = this.cls.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            const comments = commentsMetadata.getComments();
            comments.forEach(comment => {
                this.printer.writeIndent().writeLine(comment.content);
            });
        }
        this.printDecorator(this.cls.getDecorators());
        // print export class name<> + extends c0 implements x1, x2 {
        this.printer
            .writeIndent()
            .writeSpace(this.modifiersToString(this.cls.getModifiers()))
            .write(`${this.classOriginTypeToString(this.cls.getCategory())} `);
        if (!PrinterUtils_1.PrinterUtils.isAnonymousClass(this.cls.getName())) {
            this.printer.write(this.cls.getName());
        }
        const genericsTypes = this.cls.getGenericsTypes();
        if (genericsTypes) {
            this.printer.write(`<${this.transformer.typeArrayToString(genericsTypes)}>`);
        }
        if (this.cls.getSuperClassName() && !this.cls.hasComponentDecorator()) {
            this.printer.write(` extends ${this.cls.getSuperClassName()}`);
        }
        if (this.cls.getImplementedInterfaceNames().length > 0) {
            this.printer.write(` implements ${this.cls.getImplementedInterfaceNames().join(', ')}`);
        }
        this.printer.writeLine(' {');
        this.printer.incIndent();
        let items = [];
        items.push(...this.printFields());
        items.push(...this.printMethods());
        items.sort((a, b) => a.getLine() - b.getLine());
        items.forEach((v) => {
            this.printer.write(v.dump());
        });
        this.printer.decIndent();
        this.printer.writeIndent().write('}');
        if (!PrinterUtils_1.PrinterUtils.isAnonymousClass(this.cls.getName())) {
            this.printer.writeLine('');
        }
        return this.printer.toString();
    }
    dumpObject() {
        this.printer.write('{');
        this.cls.getFields().forEach((field, index, array) => {
            let name = PrinterUtils_1.PrinterUtils.escape(field.getName());
            if (PrinterUtils_1.PrinterUtils.isIdentifierText(field.getName())) {
                this.printer.write(name);
            }
            else {
                this.printer.write(`'${name}'`);
            }
            let instanceInitializer = this.parseFieldInitMethod(Const_1.INSTANCE_INIT_METHOD_NAME);
            if (instanceInitializer.has(field.getName())) {
                this.printer.write(`: ${instanceInitializer.get(field.getName())}`);
            }
            if (index !== array.length - 1) {
                this.printer.write(`, `);
            }
        });
        this.printer.write('}');
        return this.printer.toString();
    }
    dumpTypeLiteral() {
        this.printer.write('{');
        this.cls.getFields().forEach((field, index, array) => {
            let name = PrinterUtils_1.PrinterUtils.escape(field.getName());
            if (PrinterUtils_1.PrinterUtils.isIdentifierText(field.getName())) {
                this.printer.write(`${name}: ${this.transformer.typeToString(field.getType())}`);
            }
            else {
                this.printer.write(`'${name}': ${this.transformer.typeToString(field.getType())}`);
            }
            if (index !== array.length - 1) {
                this.printer.write(`, `);
            }
        });
        this.printer.write('}');
        return this.printer.toString();
    }
    printMethods() {
        let items = [];
        for (let method of this.cls.getMethods()) {
            if (method.isGenerated() || (PrinterUtils_1.PrinterUtils.isConstructorMethod(method.getName()) && this.cls.hasViewTree())) {
                continue;
            }
            if (method.isDefaultArkMethod()) {
                items.push(...new SourceMethod_1.SourceMethod(method, this.printer.getIndent()).dumpDefaultMethod());
            }
            else if (!PrinterUtils_1.PrinterUtils.isAnonymousMethod(method.getName())) {
                items.push(new SourceMethod_1.SourceMethod(method, this.printer.getIndent()));
            }
        }
        return items;
    }
    printFields() {
        let instanceInitializer = this.parseFieldInitMethod(Const_1.INSTANCE_INIT_METHOD_NAME);
        let staticInitializer = this.parseFieldInitMethod(Const_1.STATIC_INIT_METHOD_NAME);
        let items = [];
        for (let field of this.cls.getFields()) {
            if (field.getCategory() === ArkField_1.FieldCategory.GET_ACCESSOR) {
                continue;
            }
            if (field.isStatic()) {
                items.push(new SourceField_1.SourceField(field, this.printer.getIndent(), staticInitializer));
            }
            else {
                items.push(new SourceField_1.SourceField(field, this.printer.getIndent(), instanceInitializer));
            }
        }
        return items;
    }
    parseFieldInitMethod(name) {
        var _a;
        let method = (_a = this.cls.getMethodWithName(name)) !== null && _a !== void 0 ? _a : this.cls.getStaticMethodWithName(name);
        if (!method || (method === null || method === void 0 ? void 0 : method.getBody()) === undefined) {
            return new Map();
        }
        let srcBody = new SourceBody_1.SourceBody(this.printer.getIndent(), method, false);
        srcBody.dump();
        return srcBody.getTempCodeMap();
    }
}
exports.SourceClass = SourceClass;
class SourceDefaultClass extends SourceClass {
    constructor(cls, indent = '') {
        super(cls, indent);
    }
    getLine() {
        return this.cls.getLine();
    }
    dump() {
        this.printMethods();
        return this.printer.toString();
    }
}
exports.SourceDefaultClass = SourceDefaultClass;
