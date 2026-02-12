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
exports.ExportPrinter = void 0;
const ArkExport_1 = require("../../core/model/ArkExport");
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const BasePrinter_1 = require("./BasePrinter");
const TSConst_1 = require("../../core/common/TSConst");
class ExportPrinter extends BasePrinter_1.BasePrinter {
    constructor(info, indent = '') {
        super(indent);
        this.info = info;
    }
    getLine() {
        return this.info.getOriginTsPosition().getLineNo();
    }
    dump() {
        this.printer.clear();
        const commentsMetadata = this.info.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            this.printComments(commentsMetadata);
        }
        if (!this.info.getFrom() &&
            (this.info.isExport() || this.info.getExportClauseType() === ArkExport_1.ExportType.LOCAL || this.info.getExportClauseType() === ArkExport_1.ExportType.TYPE)) {
            return this.printer.toString();
        }
        if (this.info.getExportClauseName().startsWith(TSConst_1.TEMP_EXPORT_ALL_PREFIX)) {
            // just like: export * as xx from './yy'
            this.printer.writeIndent().write(`export *`);
        }
        else {
            // just like: export {xxx as x} from './yy'
            if (this.info.getNameBeforeAs() === '*') {
                this.printer.writeIndent().write(`export * as ${this.info.getExportClauseName()}`);
            }
            else if (this.info.getNameBeforeAs()) {
                this.printer.write(`export {${this.info.getNameBeforeAs()} as ${this.info.getExportClauseName()}}`);
            }
            else {
                this.printer.write(`export {${this.info.getExportClauseName()}}`);
            }
        }
        if (this.info.getFrom()) {
            this.printer.write(` from '${this.info.getFrom()}'`);
        }
        this.printer.writeLine(';');
        return this.printer.toString();
    }
}
exports.ExportPrinter = ExportPrinter;
//# sourceMappingURL=ExportPrinter.js.map