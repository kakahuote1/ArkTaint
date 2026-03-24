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
exports.SourceBase = void 0;
const BasePrinter_1 = require("../base/BasePrinter");
class SourceBase extends BasePrinter_1.BasePrinter {
    constructor(arkFile, indent = '') {
        super(indent);
        this.inBuilder = false;
        this.arkFile = arkFile;
    }
    getDeclaringArkNamespace() {
        return undefined;
    }
    getArkFile() {
        return this.arkFile;
    }
    getMethod(signature) {
        return this.getArkFile().getScene().getMethod(signature);
    }
    getClass(signature) {
        return this.getArkFile().getScene().getClass(signature);
    }
    getPrinter() {
        return this.printer;
    }
    transTemp2Code(temp) {
        return temp.getName();
    }
    isInBuilderMethod() {
        return this.inBuilder;
    }
    resolveKeywordType(keywordStr) {
        // 'NumberKeyword | NullKeyword |
        let types = [];
        for (let keyword of keywordStr.split('|')) {
            keyword = keyword.trim();
            if (keyword.length === 0) {
                continue;
            }
            if (keyword.endsWith('Keyword')) {
                keyword = keyword.substring(0, keyword.length - 'Keyword'.length).toLowerCase();
            }
            types.push(keyword);
        }
        return types.join(' | ');
    }
}
exports.SourceBase = SourceBase;
