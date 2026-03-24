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
exports.ArkIRNamespacePrinter = void 0;
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const BasePrinter_1 = require("../base/BasePrinter");
const ArkIRClassPrinter_1 = require("./ArkIRClassPrinter");
const ExportPrinter_1 = require("../base/ExportPrinter");
/**
 * @category save
 */
class ArkIRNamespacePrinter extends BasePrinter_1.BasePrinter {
    constructor(ns, indent = '') {
        super(indent);
        this.ns = ns;
    }
    getLine() {
        return this.ns.getLine();
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
            items.push(new ArkIRClassPrinter_1.ArkIRClassPrinter(cls, this.printer.getIndent()));
        }
        // print namespace
        for (let childNs of this.ns.getNamespaces()) {
            items.push(new ArkIRNamespacePrinter(childNs, this.printer.getIndent()));
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
exports.ArkIRNamespacePrinter = ArkIRNamespacePrinter;
