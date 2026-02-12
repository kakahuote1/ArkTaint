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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModulePath = exports.FileUtils = void 0;
exports.getFileRecursively = getFileRecursively;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importStar(require("./logger"));
const pathTransfer_1 = require("./pathTransfer");
const EtsConst_1 = require("../core/common/EtsConst");
const ArkFile_1 = require("../core/model/ArkFile");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'FileUtils');
class FileUtils {
    static getIndexFileName(srcPath) {
        for (const fileInDir of fs_1.default.readdirSync(srcPath, { withFileTypes: true })) {
            if (fileInDir.isFile() && /^index(\.d)?\.e?ts$/i.test(fileInDir.name)) {
                return fileInDir.name;
            }
        }
        return '';
    }
    static isDirectory(srcPath) {
        try {
            const stats = fs_1.default.statSync(srcPath, { throwIfNoEntry: false });
            return stats ? stats.isDirectory() : false;
        }
        catch (e) {
            logger.warn(srcPath + ' not found.');
        }
        return false;
    }
    static isAbsolutePath(path) {
        return /^(\/|\\|[A-Z]:\\)/.test(path);
    }
    static generateModuleMap(ohPkgContentMap) {
        const moduleMap = new Map();
        ohPkgContentMap.forEach((content, filePath) => {
            const moduleName = content.name;
            if (moduleName && moduleName.startsWith('@')) {
                const modulePath = path_1.default.dirname(filePath);
                moduleMap.set(moduleName, new ModulePath(modulePath, content.main ? path_1.default.resolve(modulePath, content.main) : ''));
            }
        });
        ohPkgContentMap.forEach((content, filePath) => {
            if (!content.dependencies) {
                return;
            }
            Object.entries(content.dependencies).forEach(([name, value]) => {
                if (moduleMap.get(name)) {
                    return;
                }
                const dir = path_1.default.dirname(filePath);
                let modulePath = path_1.default.resolve(dir, value.replace('file:', ''));
                let main = '';
                if (this.isDirectory(modulePath)) {
                    const target = ohPkgContentMap.get(path_1.default.resolve(modulePath, EtsConst_1.OH_PACKAGE_JSON5));
                    if (target?.main) {
                        main = path_1.default.resolve(modulePath, target.main);
                    }
                }
                else {
                    modulePath = path_1.default.resolve(dir, 'oh_modules', name);
                }
                moduleMap.set(name, new ModulePath(modulePath, main));
            });
        });
        return moduleMap;
    }
    static getFileLanguage(file, fileTags) {
        if (fileTags && fileTags.has(file)) {
            return fileTags.get(file);
        }
        const extension = path_1.default.extname(file).toLowerCase();
        switch (extension) {
            case '.ts':
                return ArkFile_1.Language.TYPESCRIPT;
            case '.ets':
                return ArkFile_1.Language.ARKTS1_1;
            case '.js':
                return ArkFile_1.Language.JAVASCRIPT;
            default:
                return ArkFile_1.Language.UNKNOWN;
        }
    }
}
exports.FileUtils = FileUtils;
FileUtils.FILE_FILTER = {
    ignores: ['.git', '.preview', '.hvigor', '.idea', 'test', 'ohosTest'],
    include: /(?<!\.d)\.(ets|ts|json5)$/,
};
class ModulePath {
    constructor(path, main) {
        this.path = (0, pathTransfer_1.transfer2UnixPath)(path);
        this.main = main ? (0, pathTransfer_1.transfer2UnixPath)(main) : main;
    }
}
exports.ModulePath = ModulePath;
function getFileRecursively(srcDir, fileName, visited = new Set()) {
    let res = '';
    if (!FileUtils.isDirectory(srcDir)) {
        logger.warn(`Input directory ${srcDir} is not exist`);
        return res;
    }
    const filesUnderThisDir = fs_1.default.readdirSync(srcDir, { withFileTypes: true });
    const realSrc = fs_1.default.realpathSync(srcDir);
    if (visited.has(realSrc)) {
        return res;
    }
    visited.add(realSrc);
    filesUnderThisDir.forEach(file => {
        if (res !== '') {
            return res;
        }
        if (file.name === fileName) {
            res = path_1.default.resolve(srcDir, file.name);
            return res;
        }
        const tmpDir = path_1.default.resolve(srcDir, '../');
        res = getFileRecursively(tmpDir, fileName, visited);
        return res;
    });
    return res;
}
//# sourceMappingURL=FileUtils.js.map