"use strict";
/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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
exports.BasePrinter = void 0;
exports.setPrinterOptions = setPrinterOptions;
const ArkBaseModel_1 = require("../../core/model/ArkBaseModel");
const ArkClass_1 = require("../../core/model/ArkClass");
const Printer_1 = require("../Printer");
const PrinterUtils_1 = require("./PrinterUtils");
const Const_1 = require("../../core/common/Const");
let printerOptions = { pureTs: false, noMethodBody: false };
function setPrinterOptions(options) {
    printerOptions = { ...printerOptions, ...options };
}
class BasePrinter extends Printer_1.Printer {
    constructor(indent) {
        super(indent);
    }
    printDecorator(docorator) {
        docorator.forEach(value => {
            this.printer.writeIndent().writeLine(value.toString());
        });
    }
    printComments(commentsMetadata) {
        const comments = commentsMetadata.getComments();
        comments.forEach(comment => {
            this.printer.writeIndent().writeLine(comment.content);
        });
    }
    modifiersToString(modifiers) {
        let modifiersStr = (0, ArkBaseModel_1.modifiers2stringArray)(modifiers);
        return modifiersStr.join(' ');
    }
    resolveMethodName(name) {
        if (name === '_Constructor') {
            return 'constructor';
        }
        if (name.startsWith(Const_1.GETTER_PREFIX)) {
            return name.replace(Const_1.GETTER_PREFIX, 'get ');
        }
        if (name.startsWith(Const_1.SETTER_PREFIX)) {
            return name.replace(Const_1.SETTER_PREFIX, 'set ');
        }
        return name;
    }
    classOriginTypeToString(clsCategory) {
        if (printerOptions.pureTs) {
            if (clsCategory === ArkClass_1.ClassCategory.STRUCT) {
                clsCategory = ArkClass_1.ClassCategory.CLASS;
            }
        }
        return PrinterUtils_1.PrinterUtils.classOriginTypeToString.get(clsCategory);
    }
    static getPrinterOptions() {
        return printerOptions;
    }
}
exports.BasePrinter = BasePrinter;
//# sourceMappingURL=BasePrinter.js.map