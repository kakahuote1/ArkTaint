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
exports.ArkIRClassPrinter = void 0;
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const BasePrinter_1 = require("../base/BasePrinter");
const ArkIRFieldPrinter_1 = require("./ArkIRFieldPrinter");
const ArkIRMethodPrinter_1 = require("./ArkIRMethodPrinter");
/**
 * @category save
 */
class ArkIRClassPrinter extends BasePrinter_1.BasePrinter {
    constructor(cls, indent = '') {
        super(indent);
        this.cls = cls;
    }
    getLine() {
        return this.cls.getLine();
    }
    dump() {
        this.printer.clear();
        const commentsMetadata = this.cls.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            this.printComments(commentsMetadata);
        }
        this.printDecorator(this.cls.getDecorators());
        // print export class name<> + extends c0 implements x1, x2 {
        this.printer
            .writeIndent()
            .writeSpace(this.modifiersToString(this.cls.getModifiers()))
            .write(`${this.classOriginTypeToString(this.cls.getCategory())} `);
        this.printer.write(this.cls.getName());
        const genericsTypes = this.cls.getGenericsTypes();
        if (genericsTypes) {
            this.printer.write(`<${genericsTypes.map(v => v.toString()).join(', ')}>`);
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
        let fieldItems = this.printFields();
        fieldItems.sort((a, b) => a.getLine() - b.getLine());
        items.push(...fieldItems);
        let methodItems = this.printMethods();
        methodItems.sort((a, b) => a.getLine() - b.getLine());
        items.push(...methodItems);
        let isFirstMethod = true;
        let hasField = false;
        items.forEach((v) => {
            if (v instanceof ArkIRMethodPrinter_1.ArkIRMethodPrinter) {
                if (!isFirstMethod || hasField) {
                    this.printer.writeLine('');
                }
                else {
                    isFirstMethod = false;
                }
            }
            else if (v instanceof ArkIRFieldPrinter_1.ArkIRFieldPrinter) {
                hasField = true;
            }
            this.printer.write(v.dump());
        });
        this.printer.decIndent();
        this.printer.writeIndent().writeLine('}');
        return this.printer.toString();
    }
    printMethods() {
        let items = [];
        for (let method of this.cls.getMethods(true)) {
            items.push(new ArkIRMethodPrinter_1.ArkIRMethodPrinter(method, this.printer.getIndent()));
        }
        return items;
    }
    printFields() {
        let items = [];
        for (let field of this.cls.getFields()) {
            items.push(new ArkIRFieldPrinter_1.ArkIRFieldPrinter(field, this.printer.getIndent()));
        }
        return items;
    }
}
exports.ArkIRClassPrinter = ArkIRClassPrinter;
