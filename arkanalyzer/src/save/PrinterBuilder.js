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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenePrinter = exports.PrinterBuilder = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DotPrinter_1 = require("./DotPrinter");
const SourceFilePrinter_1 = require("./source/SourceFilePrinter");
const JsonPrinter_1 = require("./json/JsonPrinter");
const ArkIRFilePrinter_1 = require("./arkir/ArkIRFilePrinter");
const BasePrinter_1 = require("./base/BasePrinter");
/**
 * @example
 * // dump method IR to ts source
 * let method: Method = xx;
 * let srcPrinter = new SourceMethodPrinter(method);
 * PrinterBuilder.dump(srcPrinter, 'output.ts');
 *
 *
 * // dump method cfg to dot
 * let dotPrinter = new DotMethodPrinter(method);
 * PrinterBuilder.dump(dotPrinter, 'output.dot');
 *
 * // dump project
 * let printer = new PrinterBuilder('output');
 * for (let f of scene.getFiles()) {
 *     printer.dumpToTs(f);
 * }
 *
 * @category save
 */
class PrinterBuilder {
    constructor(outputDir = '') {
        this.outputDir = outputDir;
    }
    static dump(source, output) {
        fs_1.default.writeFileSync(output, source.dump());
    }
    getOutputDir(arkFile) {
        if (this.outputDir === '') {
            return path_1.default.join(arkFile.getProjectDir(), '..', 'output');
        }
        else {
            return path_1.default.join(this.outputDir);
        }
    }
    dumpToDot(arkFile, output = undefined) {
        let filename = output;
        if (filename === undefined) {
            filename = path_1.default.join(this.getOutputDir(arkFile), arkFile.getName() + '.dot');
        }
        fs_1.default.mkdirSync(path_1.default.dirname(filename), { recursive: true });
        let printer = new DotPrinter_1.DotFilePrinter(arkFile);
        PrinterBuilder.dump(printer, filename);
    }
    dumpToTs(arkFile, output = undefined) {
        let filename = output;
        if (filename === undefined) {
            filename = path_1.default.join(this.getOutputDir(arkFile), arkFile.getName());
        }
        if (path_1.default.extname(filename) === '') {
            filename += '.ts';
        }
        fs_1.default.mkdirSync(path_1.default.dirname(filename), { recursive: true });
        let printer = new SourceFilePrinter_1.SourceFilePrinter(arkFile);
        PrinterBuilder.dump(printer, filename);
    }
    dumpToJson(arkFile, output = undefined) {
        let filename = output;
        if (filename === undefined) {
            filename = path_1.default.join(this.getOutputDir(arkFile), arkFile.getName() + '.json');
        }
        fs_1.default.mkdirSync(path_1.default.dirname(filename), { recursive: true });
        let printer = new JsonPrinter_1.JsonPrinter(arkFile);
        PrinterBuilder.dump(printer, filename);
    }
    dumpToIR(arkFile, output = undefined) {
        let filename = output;
        if (filename === undefined) {
            filename = path_1.default.join(this.getOutputDir(arkFile), arkFile.getName());
        }
        filename += '.ir';
        fs_1.default.mkdirSync(path_1.default.dirname(filename), { recursive: true });
        let printer = new ArkIRFilePrinter_1.ArkIRFilePrinter(arkFile);
        PrinterBuilder.dump(printer, filename);
    }
}
exports.PrinterBuilder = PrinterBuilder;
/**
 * @example
 * // dump scene
 * let scenePrinter = new ScenePrinter(scene, 'output');
 * scenePrinter.dumpToTs();
 * scenePrinter.dumpToIR();
 *
 * @category save
 */
class ScenePrinter {
    constructor(scene, outputDir, option) {
        this.scene = scene;
        this.outputDir = outputDir;
        this.printer = new PrinterBuilder(outputDir);
        if (option) {
            (0, BasePrinter_1.setPrinterOptions)(option);
        }
    }
    dumpToDot() {
        for (let f of this.scene.getFiles()) {
            this.printer.dumpToDot(f);
        }
    }
    dumpToTs() {
        for (let f of this.scene.getFiles()) {
            let relativePath = path_1.default.relative(f.getProjectDir(), f.getFilePath());
            this.printer.dumpToTs(f, path_1.default.join(this.outputDir, relativePath));
        }
    }
    dumpToJson() {
        for (let f of this.scene.getFiles()) {
            this.printer.dumpToJson(f);
        }
    }
    dumpToIR() {
        for (let f of this.scene.getFiles()) {
            this.printer.dumpToIR(f);
        }
    }
}
exports.ScenePrinter = ScenePrinter;
//# sourceMappingURL=PrinterBuilder.js.map