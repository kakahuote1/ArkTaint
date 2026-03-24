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
exports.SourceNamespace = void 0;
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const SourceBase_1 = require("./SourceBase");
const SourceClass_1 = require("./SourceClass");
const SourceMethod_1 = require("./SourceMethod");
const PrinterUtils_1 = require("../base/PrinterUtils");
const ExportPrinter_1 = require("../base/ExportPrinter");
/**
 * @category save
 */
class SourceNamespace extends SourceBase_1.SourceBase {
    constructor(ns, indent = '') {
        super(ns.getDeclaringArkFile(), indent);
        this.ns = ns;
    }
    getLine() {
        return this.ns.getLine();
    }
    printDefaultClassInNamespace(items, cls) {
        for (let method of cls.getMethods()) {
            if (method.isDefaultArkMethod()) {
                items.push(...new SourceMethod_1.SourceMethod(method, this.printer.getIndent()).dumpDefaultMethod());
            }
            else if (!PrinterUtils_1.PrinterUtils.isAnonymousMethod(method.getName())) {
                items.push(new SourceMethod_1.SourceMethod(method, this.printer.getIndent()));
            }
        }
    }
    dump() {
        const commentsMetadata = this.ns.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            const comments = commentsMetadata.getComments();
            comments.forEach(comment => {
                this.printer.writeIndent().writeLine(comment.content);
            });
        }
        this.printer.writeIndent().writeSpace(this.modifiersToString(this.ns.getModifiers())).writeLine(`namespace ${this.ns.getName()} {`);
        this.printer.incIndent();
        let items = [];
        // print class
        for (let cls of this.ns.getClasses()) {
            if (PrinterUtils_1.PrinterUtils.isAnonymousClass(cls.getName())) {
                continue;
            }
            if (cls.isDefaultArkClass()) {
                this.printDefaultClassInNamespace(items, cls);
            }
            else {
                items.push(new SourceClass_1.SourceClass(cls, this.printer.getIndent()));
            }
        }
        // print namespace
        for (let childNs of this.ns.getNamespaces()) {
            items.push(new SourceNamespace(childNs, this.printer.getIndent()));
        }
        // print exportInfos
        for (let exportInfo of this.ns.getExportInfos()) {
            items.push(new ExportPrinter_1.ExportPrinter(exportInfo, this.printer.getIndent()));
        }
        items.sort((a, b) => a.getLine() - b.getLine());
        items.forEach((v) => {
            this.printer.write(v.dump());
        });
        this.printer.decIndent();
        this.printer.writeIndent().writeLine('}');
        return this.printer.toString();
    }
}
exports.SourceNamespace = SourceNamespace;
