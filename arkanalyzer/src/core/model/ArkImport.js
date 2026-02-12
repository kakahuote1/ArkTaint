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
exports.ImportInfo = void 0;
const Position_1 = require("../base/Position");
const ModelUtils_1 = require("../common/ModelUtils");
const ArkBaseModel_1 = require("./ArkBaseModel");
/**
 * @category core/model
 */
class ImportInfo extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.importClauseName = '';
        this.importType = '';
    }
    /**
     * Returns the program language of the file where this import info defined.
     */
    getLanguage() {
        return this.getDeclaringArkFile().getLanguage();
    }
    build(importClauseName, importType, importFrom, originTsPosition, modifiers, nameBeforeAs) {
        this.setImportClauseName(importClauseName);
        this.setImportType(importType);
        this.setImportFrom(importFrom);
        this.setOriginTsPosition(originTsPosition);
        this.addModifier(modifiers);
        this.setNameBeforeAs(nameBeforeAs);
    }
    getOriginName() {
        return this.nameBeforeAs ?? this.importClauseName;
    }
    /**
     * Returns the export information, i.e., the actual reference generated at the time of call.
     * The export information includes: clause's name, clause's type, modifiers, location
     * where it is exported from, etc. If the export information could not be found, **null** will be returned.
     * @returns The export information. If there is no export information, the return will be a **null**.
     */
    getLazyExportInfo() {
        if (this.lazyExportInfo === undefined) {
            this.lazyExportInfo = (0, ModelUtils_1.findExportInfo)(this);
        }
        return this.lazyExportInfo || null;
    }
    getExportInfo() {
        return this.lazyExportInfo;
    }
    setExportInfo(exportInfo) {
        this.lazyExportInfo = exportInfo;
    }
    setDeclaringArkFile(declaringArkFile) {
        this.declaringArkFile = declaringArkFile;
    }
    getDeclaringArkFile() {
        return this.declaringArkFile;
    }
    getImportClauseName() {
        return this.importClauseName;
    }
    setImportClauseName(importClauseName) {
        this.importClauseName = importClauseName;
    }
    getImportType() {
        return this.importType;
    }
    setImportType(importType) {
        this.importType = importType;
    }
    setImportFrom(importFrom) {
        this.importFrom = importFrom;
    }
    getNameBeforeAs() {
        return this.nameBeforeAs;
    }
    setNameBeforeAs(nameBeforeAs) {
        this.nameBeforeAs = nameBeforeAs;
    }
    setOriginTsPosition(originTsPosition) {
        this.originTsPosition = originTsPosition;
    }
    getOriginTsPosition() {
        return this.originTsPosition ?? Position_1.LineColPosition.DEFAULT;
    }
    setTsSourceCode(tsSourceCode) {
        this.tsSourceCode = tsSourceCode;
    }
    getTsSourceCode() {
        return this.tsSourceCode ?? '';
    }
    getFrom() {
        return this.importFrom;
    }
    isDefault() {
        if (this.nameBeforeAs === 'default') {
            return true;
        }
        return this.importType === 'Identifier';
    }
    validate() {
        return this.validateFields(['declaringArkFile']);
    }
}
exports.ImportInfo = ImportInfo;
//# sourceMappingURL=ArkImport.js.map