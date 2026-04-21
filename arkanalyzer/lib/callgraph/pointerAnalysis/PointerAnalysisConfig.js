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
exports.PointerAnalysisConfig = exports.ContextType = exports.PtaAnalysisScale = void 0;
const fs = __importStar(require("fs"));
const PtsDS_1 = require("./PtsDS");
var PtaAnalysisScale;
(function (PtaAnalysisScale) {
    PtaAnalysisScale[PtaAnalysisScale["WholeProgram"] = 0] = "WholeProgram";
    PtaAnalysisScale[PtaAnalysisScale["MethodLevel"] = 1] = "MethodLevel";
})(PtaAnalysisScale = exports.PtaAnalysisScale || (exports.PtaAnalysisScale = {}));
var ContextType;
(function (ContextType) {
    ContextType[ContextType["CallSite"] = 0] = "CallSite";
    ContextType[ContextType["Obj"] = 1] = "Obj";
    ContextType[ContextType["Func"] = 2] = "Func";
})(ContextType = exports.ContextType || (exports.ContextType = {}));
class PointerAnalysisConfig {
    /*
     * Note: DO NOT use `new PointerAnalysisConfig` to initialize ptaconfig
     *       Use PointerAnalysisConfig.create() for singleton pattern
     */
    constructor(kLimit, contextType, outputDirectory, detectTypeDiff = false, dotDump = false, debug = false, analysisScale = PtaAnalysisScale.WholeProgram, ptsCoType = PtsDS_1.PtsCollectionType.Set) {
        if (kLimit > 5) {
            throw new Error('K Limit too large');
        }
        this.kLimit = kLimit;
        this.outputDirectory = outputDirectory;
        this.detectTypeDiff = detectTypeDiff;
        this.dotDump = dotDump;
        this.debug = debug;
        this.analysisScale = analysisScale;
        this.ptsCollectionType = ptsCoType;
        this.ptsCollectionCtor = (0, PtsDS_1.createPtsCollectionCtor)(ptsCoType);
        this.contextType = contextType;
        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory, { recursive: true });
        }
    }
    /*
     * Set static field to be null, then all related objects could be freed by GC.
     * Class PointerAnalysisConfig has been exported by ArkAnalyzer, the dispose method should be called by users themselves before free this class.
     */
    static dispose() {
        // @ts-expect-error: only be used to free the memory
        this.instance = null;
    }
    /*
     * Create Singleton instance
     * The instance can be created multi-times and be overwrited
     */
    static create(kLimit, outputDirectory, detectTypeDiff = false, dotDump = false, debug = false, analysisScale = PtaAnalysisScale.WholeProgram, ptsCoType = PtsDS_1.PtsCollectionType.Set, contextType = ContextType.Func) {
        PointerAnalysisConfig.instance = new PointerAnalysisConfig(kLimit, contextType, outputDirectory, detectTypeDiff, dotDump, debug, analysisScale, ptsCoType);
        return PointerAnalysisConfig.instance;
    }
    /*
     * Get Singleton instance
     */
    static getInstance() {
        if (!PointerAnalysisConfig.instance) {
            throw new Error('PTA config: instance is not existing');
        }
        return PointerAnalysisConfig.instance;
    }
}
exports.PointerAnalysisConfig = PointerAnalysisConfig;
