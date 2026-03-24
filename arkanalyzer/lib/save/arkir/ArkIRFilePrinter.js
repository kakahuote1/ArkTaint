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
exports.ArkIRFilePrinter = void 0;
const Printer_1 = require("../Printer");
const ArkIRClassPrinter_1 = require("./ArkIRClassPrinter");
const ExportPrinter_1 = require("../base/ExportPrinter");
const ImportPrinter_1 = require("../base/ImportPrinter");
const ArkIRNamespacePrinter_1 = require("./ArkIRNamespacePrinter");
/**
 * @category save
 */
class ArkIRFilePrinter extends Printer_1.Printer {
    constructor(arkFile) {
        super();
        this.items = [];
        this.arkFile = arkFile;
    }
    dump() {
        // print imports
        this.items.push(...(0, ImportPrinter_1.printImports)(this.arkFile.getImportInfos(), this.printer.getIndent()));
        // print namespace
        for (let ns of this.arkFile.getNamespaces()) {
            this.items.push(new ArkIRNamespacePrinter_1.ArkIRNamespacePrinter(ns));
        }
        // print class
        for (let cls of this.arkFile.getClasses()) {
            this.items.push(new ArkIRClassPrinter_1.ArkIRClassPrinter(cls));
        }
        // print export
        for (let info of this.arkFile.getExportInfos()) {
            this.items.push(new ExportPrinter_1.ExportPrinter(info));
        }
        this.items.sort((a, b) => a.getLine() - b.getLine());
        this.items.forEach((v) => {
            this.printer.write(v.dump());
        });
        return this.printer.toString();
    }
}
exports.ArkIRFilePrinter = ArkIRFilePrinter;
