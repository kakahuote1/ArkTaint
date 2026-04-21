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
exports.SourceFilePrinter = void 0;
const SourceClass_1 = require("./SourceClass");
const SourceMethod_1 = require("./SourceMethod");
const SourceNamespace_1 = require("./SourceNamespace");
const PrinterUtils_1 = require("../base/PrinterUtils");
const ImportPrinter_1 = require("../base/ImportPrinter");
const ExportPrinter_1 = require("../base/ExportPrinter");
const Printer_1 = require("../Printer");
/**
 * @category save
 */
class SourceFilePrinter extends Printer_1.Printer {
    constructor(arkFile) {
        super();
        this.items = [];
        this.arkFile = arkFile;
    }
    printDefaultClassInFile(cls) {
        for (let method of cls.getMethods()) {
            if (method.isDefaultArkMethod()) {
                this.items.push(...new SourceMethod_1.SourceMethod(method, this.printer.getIndent()).dumpDefaultMethod());
            }
            else if (!PrinterUtils_1.PrinterUtils.isAnonymousMethod(method.getName())) {
                this.items.push(new SourceMethod_1.SourceMethod(method));
            }
        }
    }
    dump() {
        this.printer.clear();
        // print imports
        this.items.push(...(0, ImportPrinter_1.printImports)(this.arkFile.getImportInfos(), this.printer.getIndent()));
        // print namespace
        for (let ns of this.arkFile.getNamespaces()) {
            this.items.push(new SourceNamespace_1.SourceNamespace(ns));
        }
        // print class
        for (let cls of this.arkFile.getClasses()) {
            if (cls.isDefaultArkClass()) {
                this.printDefaultClassInFile(cls);
            }
            else if (!PrinterUtils_1.PrinterUtils.isAnonymousClass(cls.getName())) {
                this.items.push(new SourceClass_1.SourceClass(cls));
            }
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
exports.SourceFilePrinter = SourceFilePrinter;
