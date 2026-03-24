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
exports.ExportInfo = exports.ExportType = void 0;
const Position_1 = require("../base/Position");
const TSConst_1 = require("../common/TSConst");
const ArkBaseModel_1 = require("./ArkBaseModel");
const ArkMetadata_1 = require("./ArkMetadata");
var ExportType;
(function (ExportType) {
    ExportType[ExportType["NAME_SPACE"] = 0] = "NAME_SPACE";
    ExportType[ExportType["CLASS"] = 1] = "CLASS";
    ExportType[ExportType["METHOD"] = 2] = "METHOD";
    ExportType[ExportType["LOCAL"] = 3] = "LOCAL";
    ExportType[ExportType["TYPE"] = 4] = "TYPE";
    ExportType[ExportType["UNKNOWN"] = 9] = "UNKNOWN";
})(ExportType = exports.ExportType || (exports.ExportType = {}));
/**
 * @category core/model
 */
class ExportInfo extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.exportClauseName = '';
        this.exportClauseType = ExportType.UNKNOWN;
    }
    /**
     * Returns the program language of the file where this export info defined.
     */
    getLanguage() {
        return this.getDeclaringArkFile().getLanguage();
    }
    getFrom() {
        return this.exportFrom;
    }
    getOriginName() {
        var _a;
        return (_a = this.nameBeforeAs) !== null && _a !== void 0 ? _a : this.exportClauseName;
    }
    getExportClauseName() {
        return this.exportClauseName;
    }
    setExportClauseType(exportClauseType) {
        this.exportClauseType = exportClauseType;
    }
    getExportClauseType() {
        return this.exportClauseType;
    }
    getNameBeforeAs() {
        return this.nameBeforeAs;
    }
    setArkExport(value) {
        this.arkExport = value;
    }
    getArkExport() {
        return this.arkExport;
    }
    isDefault() {
        if (this.exportFrom) {
            return this.nameBeforeAs === TSConst_1.DEFAULT;
        }
        if (this._default === undefined) {
            this._default = this.containsModifier(ArkBaseModel_1.ModifierType.DEFAULT);
        }
        return this._default;
    }
    getOriginTsPosition() {
        var _a;
        return (_a = this.originTsPosition) !== null && _a !== void 0 ? _a : Position_1.LineColPosition.DEFAULT;
    }
    getTsSourceCode() {
        var _a;
        return (_a = this.tsSourceCode) !== null && _a !== void 0 ? _a : '';
    }
    getDeclaringArkFile() {
        return this.declaringArkFile;
    }
    getDeclaringArkNamespace() {
        return this.declaringArkNamespace;
    }
    validate() {
        return this.validateFields(['declaringArkFile']);
    }
}
exports.ExportInfo = ExportInfo;
ExportInfo.Builder = class ArkExportBuilder {
    constructor() {
        this.exportInfo = new ExportInfo();
    }
    exportClauseName(exportClauseName) {
        this.exportInfo.exportClauseName = exportClauseName;
        return this;
    }
    exportClauseType(exportClauseType) {
        this.exportInfo.setExportClauseType(exportClauseType);
        return this;
    }
    nameBeforeAs(nameBeforeAs) {
        this.exportInfo.nameBeforeAs = nameBeforeAs;
        return this;
    }
    modifiers(modifiers) {
        this.exportInfo.modifiers = modifiers;
        return this;
    }
    originTsPosition(originTsPosition) {
        this.exportInfo.originTsPosition = originTsPosition;
        return this;
    }
    tsSourceCode(tsSourceCode) {
        this.exportInfo.tsSourceCode = tsSourceCode;
        return this;
    }
    declaringArkFile(value) {
        this.exportInfo.declaringArkFile = value;
        return this;
    }
    declaringArkNamespace(value) {
        this.exportInfo.declaringArkNamespace = value;
        return this;
    }
    arkExport(value) {
        this.exportInfo.arkExport = value;
        return this;
    }
    exportFrom(exportFrom) {
        if (exportFrom !== '') {
            this.exportInfo.exportFrom = exportFrom;
        }
        return this;
    }
    setLeadingComments(commentsMetadata) {
        if (commentsMetadata.getComments().length > 0) {
            this.exportInfo.setMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS, commentsMetadata);
        }
        return this;
    }
    setTrailingComments(commentsMetadata) {
        if (commentsMetadata.getComments().length > 0) {
            this.exportInfo.setMetadata(ArkMetadata_1.ArkMetadataKind.TRAILING_COMMENTS, commentsMetadata);
        }
        return this;
    }
    build() {
        return this.exportInfo;
    }
};
