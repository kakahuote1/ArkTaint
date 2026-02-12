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

/*
 * TODO:
 *
 * 1. Method parameter:
 *  a) default value 不支持
 *      source: move(distanceInMeters = 5)
 *      parsed: move(distanceInMeters)
 *  c) string[] 类型解析为 ArrayType，无法还原
 *  d) 构造函数Access Modifiers 不支持
 *     constructor(public make: string, public model: string) {
 *     }
 *
 * 2. 泛型
 *  a) field泛型<>类型丢失
 * class GenericNumber<T> {
 *     private methods: Set<string>;
 *     private calls: Map<string, string[]>;
 * }
 */
import { ArkFile } from '../../core/model/ArkFile';
import { Dump } from '../base/BasePrinter';
import { SourceClass } from './SourceClass';
import { SourceMethod } from './SourceMethod';
import { SourceNamespace } from './SourceNamespace';
import { PrinterUtils } from '../base/PrinterUtils';
import { printImports } from '../base/ImportPrinter';
import { ExportPrinter } from '../base/ExportPrinter';
import { Printer } from '../Printer';
import { ArkClass } from '../../core/model/ArkClass';

/**
 * @category save
 */
export class SourceFilePrinter extends Printer {
    arkFile: ArkFile;
    items: Dump[] = [];

    constructor(arkFile: ArkFile) {
        super();
        this.arkFile = arkFile;
    }

    private printDefaultClassInFile(cls: ArkClass): void {
        for (let method of cls.getMethods()) {
            if (method.isDefaultArkMethod()) {
                this.items.push(...new SourceMethod(method, this.printer.getIndent()).dumpDefaultMethod());
            } else if (!PrinterUtils.isAnonymousMethod(method.getName())) {
                this.items.push(new SourceMethod(method));
            }
        }
    }

    public dump(): string {
        this.printer.clear();
        // print imports
        this.items.push(...printImports(this.arkFile.getImportInfos(), this.printer.getIndent()));

        // print namespace
        for (let ns of this.arkFile.getNamespaces()) {
            this.items.push(new SourceNamespace(ns));
        }

        // print class
        for (let cls of this.arkFile.getClasses()) {
            if (cls.isDefaultArkClass()) {
                this.printDefaultClassInFile(cls);
            } else if (!PrinterUtils.isAnonymousClass(cls.getName())) {
                this.items.push(new SourceClass(cls));
            }
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
