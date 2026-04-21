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
exports.program = exports.serializeScene = exports.serializeArkFile = exports.buildSceneFromProjectDir = exports.buildSceneFromSingleFile = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const commander_1 = require("commander");
const PrinterBuilder_1 = require("../PrinterBuilder");
const Config_1 = require("../../Config");
const Scene_1 = require("../../Scene");
const JsonPrinter_1 = require("./JsonPrinter");
const PointerAnalysis_1 = require("../../callgraph/pointerAnalysis/PointerAnalysis");
const FileUtils_1 = require("../../utils/FileUtils");
function buildSceneFromSingleFile(filename, verbose = false) {
    if (verbose) {
        console.log('Building scene...');
    }
    const filepath = path_1.default.resolve(filename);
    const projectDir = path_1.default.dirname(filepath);
    const config = new Config_1.SceneConfig();
    config.buildConfig('single-file', projectDir, []);
    config.projectFiles = [filepath]; // Force single file
    const scene = new Scene_1.Scene();
    scene.buildSceneFromProjectDir(config);
    return scene;
}
exports.buildSceneFromSingleFile = buildSceneFromSingleFile;
function buildSceneFromProjectDir(inputDir, verbose = false) {
    if (verbose) {
        console.log('Building scene...');
    }
    const config = new Config_1.SceneConfig();
    config.buildFromProjectDir(inputDir);
    const scene = new Scene_1.Scene();
    scene.buildSceneFromProjectDir(config);
    return scene;
}
exports.buildSceneFromProjectDir = buildSceneFromProjectDir;
function serializeArkFile(arkFile, output) {
    let filename = output;
    if (filename === undefined) {
        const outputDir = path_1.default.join(arkFile.getProjectDir(), '..', 'output');
        filename = path_1.default.join(outputDir, arkFile.getName() + '.json');
    }
    fs_1.default.mkdirSync(path_1.default.dirname(filename), { recursive: true });
    const printer = new JsonPrinter_1.JsonPrinter(arkFile);
    const fd = fs_1.default.openSync(filename, 'w');
    fs_1.default.writeFileSync(fd, printer.dump());
    fs_1.default.closeSync(fd);
}
exports.serializeArkFile = serializeArkFile;
function serializeScene(scene, outDir, verbose = false) {
    const files = scene.getFiles();
    console.log(`Serializing Scene with ${files.length} files to '${outDir}'...`);
    for (const f of files) {
        const filepath = f.getName();
        const outPath = path_1.default.join(outDir, filepath + '.json');
        if (verbose) {
            console.log(`Serializing ArkIR for '${filepath}' to '${outPath}'...`);
        }
        serializeArkFile(f, outPath);
    }
    if (verbose) {
        console.log(`All ${files.length} files in scene are serialized`);
    }
}
exports.serializeScene = serializeScene;
function serializeSingleTsFile(input, output, options) {
    options.verbose && console.log(`Serializing TS file to JSON: '${input}' -> '${output}'`);
    const filepath = path_1.default.resolve(input);
    const projectDir = path_1.default.dirname(filepath);
    const scene = buildSceneFromSingleFile(filepath, options.verbose);
    const files = scene.getFiles();
    if (options.verbose) {
        console.log(`Scene contains ${files.length} files`);
        for (const f of files) {
            console.log(`- '${f.getName()}'`);
        }
    }
    if (options.inferTypes) {
        options.verbose && console.log('Inferring types...');
        scene.inferTypes();
        if (options.inferTypes > 1) {
            for (let i = 1; i < options.inferTypes; i++) {
                options.verbose && console.log(`Inferring types one more time (${i + 1} / ${options.inferTypes})...`);
                scene.inferTypes();
            }
        }
    }
    if (options.entrypoint) {
        options.verbose && console.log('Generating entrypoint...');
        PointerAnalysis_1.PointerAnalysis.pointerAnalysisForWholeProject(scene);
    }
    options.verbose && console.log('Extracting single ArkFile...');
    if (files.length === 0) {
        console.error(`ERROR: No files found in the project directory '${projectDir}'.`);
        process.exit(1);
    }
    if (files.length > 1) {
        console.error(`ERROR: More than one file found in the project directory '${projectDir}'.`);
        process.exit(1);
    }
    // Note: we explicitly push a single path to the project files (in config),
    //       so we expect there is only *one* ArkFile in the scene.
    const arkFile = scene.getFiles()[0];
    serializeFile(arkFile, output, options, scene);
    options.verbose && console.log('All done!');
}
function serializeFile(arkFile, output, options, scene) {
    let outPath;
    if (FileUtils_1.FileUtils.isDirectory(output)) {
        outPath = path_1.default.join(output, arkFile.getName() + '.json');
    }
    else if (!fs_1.default.existsSync(output) && output.endsWith('/')) {
        outPath = path_1.default.join(output, arkFile.getName() + '.json');
    }
    else {
        outPath = output;
    }
    console.log(`Serializing ArkIR for '${arkFile.getName()}' to '${outPath}'...`);
    const printer = new PrinterBuilder_1.PrinterBuilder();
    printer.dumpToJson(arkFile, outPath);
    if (options.entrypoint) {
        const arkFile = scene.getFiles()[1];
        let outPath;
        if (FileUtils_1.FileUtils.isDirectory(output)) {
            outPath = path_1.default.join(output, arkFile.getName() + '.json');
        }
        else if (!fs_1.default.existsSync(output) && output.endsWith('/')) {
            outPath = path_1.default.join(output, arkFile.getName() + '.json');
        }
        else {
            outPath = path_1.default.join(path_1.default.dirname(output), arkFile.getName() + '.json');
        }
        console.log(`Serializing entrypoint to '${outPath}'...`);
        printer.dumpToJson(arkFile, outPath);
    }
}
function serializeTsProject(inputDir, outDir, options) {
    console.log(`Serializing TS project to JSON: '${inputDir}' -> '${outDir}'`);
    if (!FileUtils_1.FileUtils.isDirectory(outDir)) {
        console.error(`ERROR: Output path must be a directory.`);
        process.exit(1);
    }
    const scene = buildSceneFromProjectDir(inputDir, options.verbose);
    if (options.inferTypes) {
        if (options.verbose) {
            console.log('Inferring types...');
        }
        scene.inferTypes();
        if (options.inferTypes > 1) {
            for (let i = 1; i < options.inferTypes; i++) {
                options.verbose && console.log(`Inferring types one more time (${i + 1} / ${options.inferTypes})...`);
                scene.inferTypes();
            }
        }
    }
    if (options.entrypoint) {
        if (options.verbose) {
            console.log('Generating entrypoint...');
        }
        PointerAnalysis_1.PointerAnalysis.pointerAnalysisForWholeProject(scene);
    }
    serializeScene(scene, outDir, options.verbose);
    if (options.verbose) {
        console.log('All done!');
    }
}
function myParseInt(value, _previous) {
    const parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue)) {
        throw new commander_1.InvalidArgumentError('Must be a number.');
    }
    if (parsedValue < 1) {
        throw new commander_1.InvalidArgumentError('Must be greater than 0.');
    }
    return parsedValue;
}
exports.program = new commander_1.Command()
    .name('serializeArkIR')
    .description('Serialize ArkIR for TypeScript files or projects to JSON')
    .argument('<input>', 'Input file or directory')
    .argument('<output>', 'Output file or directory')
    .option('-p, --project', 'Flag to indicate the input is a project directory', false)
    .option('-t, --infer-types [times]', 'Infer types in the ArkIR', myParseInt)
    .option('-e, --entrypoint', 'Generate entrypoint for the files', false)
    .option('-v, --verbose', 'Verbose output', false)
    .action((input, output, options) => {
    // Check for invalid combinations of flags
    if (options.multi && options.project) {
        console.error(`ERROR: You cannot provide both the '-m' and '-p' flags.`);
        process.exit(1);
    }
    // Ensure the input path exists
    if (!fs_1.default.existsSync(input)) {
        console.error(`ERROR: The input path '${input}' does not exist.`);
        process.exit(1);
    }
    // Handle the case where the input is a directory
    if (FileUtils_1.FileUtils.isDirectory(input) && !(options.multi || options.project)) {
        console.error(`ERROR: If the input is a directory, you must provide the '-p' or '-m' flag.`);
        process.exit(1);
    }
    if (options.project) {
        serializeTsProject(input, output, options);
    }
    else {
        serializeSingleTsFile(input, output, options);
    }
});
if (require.main === module) {
    exports.program.parse(process.argv);
}
