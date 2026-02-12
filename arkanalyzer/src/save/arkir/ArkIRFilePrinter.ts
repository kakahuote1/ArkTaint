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

import { ArkFile } from '../../core/model/ArkFile';
import { Dump } from '../base/BasePrinter';
import { Printer } from '../Printer';
import { ArkIRClassPrinter } from './ArkIRClassPrinter';
import { ExportPrinter } from '../base/ExportPrinter';
import { printImports } from '../base/ImportPrinter';
import { ArkIRNamespacePrinter } from './ArkIRNamespacePrinter';

/**
 * @category save
 */
export class ArkIRFilePrinter extends Printer {
    arkFile: ArkFile;
    items: Dump[] = [];

    constructor(arkFile: ArkFile) {
        super();
        this.arkFile = arkFile;
    }

    public dump(): string {
        // print imports
        this.items.push(...printImports(this.arkFile.getImportInfos(), this.printer.getIndent()));

        // print namespace
        for (let ns of this.arkFile.getNamespaces()) {
            this.items.push(new ArkIRNamespacePrinter(ns));
        }
        // print class
        for (let cls of this.arkFile.getClasses()) {
            this.items.push(new ArkIRClassPrinter(cls));
        }

        // print export
        for (let info of this.arkFile.getExportInfos()) {
            this.items.push(new ExportPrinter(info));
        }

        this.items.sort((a, b) => a.getLine() - b.getLine());
        this.items.forEach((v): void => {
            this.printer.write(v.dump());
        });

        return this.printer.toString();
    }
}
