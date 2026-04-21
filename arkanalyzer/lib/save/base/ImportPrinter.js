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
exports.printImports = exports.ImportPrinter = void 0;
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const BasePrinter_1 = require("./BasePrinter");
class ImportPrinter extends BasePrinter_1.BasePrinter {
    constructor(infos, indent = '') {
        super(indent);
        this.infos = infos;
    }
    getLine() {
        return this.infos[0].getOriginTsPosition().getLineNo();
    }
    dump() {
        const commentsMetadata = this.infos[0].getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            this.printComments(commentsMetadata);
        }
        let clauseNames = [];
        let namedImports = [];
        for (const info of this.infos) {
            if (info.getImportType() === 'Identifier') {
                // sample: import fs from 'fs'
                clauseNames.push(info.getImportClauseName());
            }
            else if (info.getImportType() === 'NamedImports') {
                // sample: import {xxx} from './yyy'
                if (info.getNameBeforeAs()) {
                    namedImports.push(`${info.getNameBeforeAs()} as ${info.getImportClauseName()}`);
                }
                else {
                    namedImports.push(info.getImportClauseName());
                }
            }
            else if (info.getImportType() === 'NamespaceImport') {
                // sample: import * as ts from 'ohos-typescript'
                clauseNames.push(`* as ${info.getImportClauseName()}`);
            }
            else if (info.getImportType() === 'EqualsImport') {
                // sample: import mmmm = require('./xxx')
                this.printer.writeIndent().writeLine(`import ${info.getImportClauseName()} =  require('${info.getFrom()}');`);
            }
            else {
                // sample: import '../xxx'
                this.printer.writeIndent().writeLine(`import '${info.getFrom()}';`);
            }
        }
        if (namedImports.length > 0) {
            clauseNames.push(`{${namedImports.join(', ')}}`);
        }
        this.printer.writeIndent().writeLine(`import ${clauseNames.join(', ')} from '${this.infos[0].getFrom()}';`);
        return this.printer.toString();
    }
}
exports.ImportPrinter = ImportPrinter;
function mergeImportInfos(infos) {
    let map = new Map();
    for (let info of infos) {
        let key = `${info.getOriginTsPosition().getLineNo()}-${info.getFrom()}`;
        let merge = map.get(key) || [];
        merge.push(info);
        map.set(key, merge);
    }
    return map;
}
function printImports(imports, indent) {
    let mergeImports = mergeImportInfos(imports);
    let items = [];
    for (const [_, importInfos] of mergeImports) {
        items.push(new ImportPrinter(importInfos, indent));
    }
    return items;
}
exports.printImports = printImports;
