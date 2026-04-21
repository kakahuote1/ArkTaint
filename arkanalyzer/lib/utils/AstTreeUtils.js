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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AstTreeUtils = void 0;
const __1 = require("..");
const EtsConst_1 = require("../core/common/EtsConst");
const crypto = __importStar(require("crypto"));
const sourceFileCache = new Map();
class AstTreeUtils {
    /**
     * get source file from code segment
     * @param fileName source file name
     * @param code source code
     * @returns ts.SourceFile
     */
    static getASTNode(fileName, code) {
        const key = this.getKeyFromCode(code);
        let sourceFile = sourceFileCache.get(key);
        if (sourceFile) {
            return sourceFile;
        }
        sourceFile = this.createSourceFile(fileName, code);
        sourceFileCache.set(key, sourceFile);
        return sourceFile;
    }
    /**
     * get source file from ArkFile
     * @param arkFile ArkFile
     * @returns ts.SourceFile
     */
    static getSourceFileFromArkFile(arkFile) {
        let sourceFile = arkFile.getAST();
        if (sourceFile) {
            return sourceFile;
        }
        const signature = arkFile.getFileSignature().toString();
        const key = this.getKeyFromCode(signature);
        sourceFile = sourceFileCache.get(key);
        if (sourceFile) {
            return sourceFile;
        }
        sourceFile = this.createSourceFile(arkFile.getName(), arkFile.getCode());
        sourceFileCache.set(key, sourceFile);
        return sourceFile;
    }
    static createSourceFile(fileName, code) {
        return __1.ts.createSourceFile(fileName, code, __1.ts.ScriptTarget.Latest, true, undefined, EtsConst_1.ETS_COMPILER_OPTIONS);
    }
    /**
     * convert source code to hash string
     * @param code source code
     * @returns string
     */
    static getKeyFromCode(code) {
        return crypto.createHash('sha256').update(code).digest('hex');
    }
}
exports.AstTreeUtils = AstTreeUtils;
