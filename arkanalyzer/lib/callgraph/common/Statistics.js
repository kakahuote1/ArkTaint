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
exports.CGStat = exports.PAGStat = exports.PTAStat = void 0;
const Stmt_1 = require("../../core/base/Stmt");
const Type_1 = require("../../core/base/Type");
const CallGraph_1 = require("../model/CallGraph");
const logger_1 = __importStar(require("../../utils/logger"));
const Local_1 = require("../../core/base/Local");
const Ref_1 = require("../../core/base/Ref");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'PTA');
const LABEL_WIDTH = 55;
class StatTraits {
    constructor() {
        this.TotalTime = 0;
        this.startTime = 0;
        this.endTime = 0;
    }
    getStat() {
        return '';
    }
    printStat() {
        logger.trace(this.getStat());
    }
}
class PTAStat extends StatTraits {
    constructor(pta) {
        super();
        this.numProcessedAddr = 0;
        this.numProcessedCopy = 0;
        this.numProcessedLoad = 0;
        this.numProcessedWrite = 0;
        this.numProcessedThis = 0;
        this.numRealWrite = 0;
        this.numRealLoad = 0;
        this.numUnhandledFun = 0;
        this.numTotalValuesInHandedFun = 0;
        this.numTotalHandledValue = 0;
        // Original type is UnknownType but inferred by PTA
        this.numInferedUnknownValue = 0;
        // Original type is not UnknownType and inferred with different type by PTA
        this.numInferedDiffTypeValue = 0;
        // Total number of values in the functions visited by PTA
        this.totalValuesInVisitedFunc = 0;
        // Original type is UnkonwnType and not inferred by PTA as well
        this.numNotInferedUnknownValue = 0;
        this.numUnhandledFunc = 0;
        this.iterTimes = 0;
        this.rssUsed = 0;
        this.heapUsed = 0;
        this.pta = pta;
    }
    startStat() {
        this.startTime = this.getNow();
        this.startMemUsage = process.memoryUsage();
    }
    endStat() {
        this.endTime = this.getNow();
        this.endMemUsage = process.memoryUsage();
        this.TotalTime = (this.endTime - this.startTime) / 1000;
        this.rssUsed = Number(this.endMemUsage.rss - this.startMemUsage.rss) / Number(1024 * 1024);
        this.heapUsed = Number(this.endMemUsage.heapTotal - this.startMemUsage.heapTotal) / Number(1024 * 1024);
        this.getInferedStat();
        this.getUnhandledFuncStat();
    }
    getNow() {
        return new Date().getTime();
    }
    getInferedStat() {
        let dm = this.pta.getTypeDiffMap();
        for (let [v] of dm) {
            if (v instanceof Local_1.Local) {
                if (v.getName() === 'this') {
                    continue;
                }
                let s = v.getDeclaringStmt();
                if (s instanceof Stmt_1.ArkAssignStmt &&
                    s.getLeftOp() instanceof Local_1.Local &&
                    s.getLeftOp().getName() === 'this' &&
                    s.getRightOp() instanceof Ref_1.ArkThisRef) {
                    continue;
                }
                if (v.getType() instanceof Type_1.UnknownType) {
                    this.numInferedUnknownValue++;
                }
                else {
                    this.numInferedDiffTypeValue++;
                }
            }
            else {
                if (v.getType() instanceof Type_1.UnknownType) {
                    this.numInferedUnknownValue++;
                }
                else {
                    this.numInferedDiffTypeValue++;
                }
            }
        }
        this.getNotInferredUnknownStat();
    }
    getNotInferredUnknownStat() {
        let inferred = new Set(this.pta.getTypeDiffMap().keys());
        let visited = new Set();
        let stmtStat = (s) => {
            if (!(s instanceof Stmt_1.ArkAssignStmt)) {
                return;
            }
            let lop = s.getLeftOp();
            if (visited.has(lop)) {
                return;
            }
            visited.add(lop);
            if (!inferred.has(lop) && lop.getType() instanceof Type_1.UnknownType) {
                this.numNotInferedUnknownValue++;
            }
            this.totalValuesInVisitedFunc++;
        };
        let cg = this.pta.getCallGraph();
        this.pta.getHandledFuncs().forEach(funcID => {
            var _a;
            let f = cg.getArkMethodByFuncID(funcID);
            (_a = f === null || f === void 0 ? void 0 : f.getCfg()) === null || _a === void 0 ? void 0 : _a.getStmts().forEach(s => stmtStat(s));
        });
    }
    getUnhandledFuncStat() {
        let cg = this.pta.getCallGraph();
        this.pta.getUnhandledFuncs().forEach(funcID => {
            let cgNode = cg.getNode(funcID);
            if (cgNode.isSdkMethod()) {
                return;
            }
            let f = cg.getArkMethodByFuncID(funcID);
            if (f) {
                this.numUnhandledFun++;
            }
        });
    }
    getStat() {
        const title = ' Pointer Analysis Statistics ';
        const padding = '='.repeat((LABEL_WIDTH - title.length) / 2);
        return `${padding}${title}${padding}
${'Processed address'.padEnd(LABEL_WIDTH)}${this.numProcessedAddr}
${'Processed copy'.padEnd(LABEL_WIDTH)}${this.numProcessedCopy}
${'Processed load'.padEnd(LABEL_WIDTH)}${this.numProcessedLoad}
${'Processed write'.padEnd(LABEL_WIDTH)}${this.numProcessedWrite}
${'Real write'.padEnd(LABEL_WIDTH)}${this.numRealWrite}
${'Real load'.padEnd(LABEL_WIDTH)}${this.numRealLoad}
${'Processed This'.padEnd(LABEL_WIDTH)}${this.numProcessedThis}
${'Unhandled function'.padEnd(LABEL_WIDTH)}${this.numUnhandledFun}
${'Total values in visited function'.padEnd(LABEL_WIDTH)}${this.totalValuesInVisitedFunc}
${'Infered Value unknown+different type'.padEnd(LABEL_WIDTH)}${this.numInferedUnknownValue}+${this.numInferedDiffTypeValue}
${'Total Time'.padEnd(LABEL_WIDTH)}${this.TotalTime} S
${'Total iterator Times'.padEnd(LABEL_WIDTH)}${this.iterTimes}
${'RSS used'.padEnd(LABEL_WIDTH)}${this.rssUsed.toFixed(3)} Mb
${'Heap used'.padEnd(LABEL_WIDTH)}${this.heapUsed.toFixed(3)} Mb`;
    }
    printStat() {
        logger.trace(this.getStat());
    }
}
exports.PTAStat = PTAStat;
class PAGStat extends StatTraits {
    constructor() {
        super(...arguments);
        this.numDynamicCall = 0;
        this.numTotalFunction = 0;
        this.numTotalNode = 0;
    }
    getStat() {
        const title = ' PAG Statistics ';
        const padding = '='.repeat((LABEL_WIDTH - title.length) / 2);
        return `${padding}${title}${padding}
${`PAG Dynamic call`.padEnd(LABEL_WIDTH)}${this.numDynamicCall}
${`Total function handled`.padEnd(LABEL_WIDTH)}${this.numTotalFunction}
${`Total PAG Nodes`.padEnd(LABEL_WIDTH)}${this.numTotalNode}`;
    }
    printStat() {
        logger.trace(this.getStat());
    }
}
exports.PAGStat = PAGStat;
class CGStat extends StatTraits {
    constructor() {
        super(...arguments);
        //real, vitual, intrinsic, constructor
        this.numTotalNode = 0;
        this.numReal = 0;
        this.numVirtual = 0;
        this.numIntrinsic = 0;
        this.numConstructor = 0;
        this.numBlank = 0;
    }
    startStat() {
        this.startTime = new Date().getTime();
    }
    endStat() {
        this.endTime = new Date().getTime();
        this.TotalTime = (this.endTime - this.startTime) / 1000;
    }
    addNodeStat(kind) {
        switch (kind) {
            case CallGraph_1.CallGraphNodeKind.real:
                this.numReal++;
                break;
            case CallGraph_1.CallGraphNodeKind.vitual:
                this.numVirtual++;
                break;
            case CallGraph_1.CallGraphNodeKind.constructor:
                this.numConstructor++;
                break;
            case CallGraph_1.CallGraphNodeKind.intrinsic:
                this.numIntrinsic++;
                break;
            default:
                this.numBlank++;
        }
        this.numTotalNode++;
    }
    getStat() {
        const title = ' CG Statistics ';
        const padding = '='.repeat((LABEL_WIDTH - title.length) / 2);
        return `${padding}${title}${padding}
${'CG construction Total Time'.padEnd(LABEL_WIDTH)}${this.TotalTime} S
${'Real function'.padEnd(LABEL_WIDTH)}${this.numReal}
${'Intrinsic function'.padEnd(LABEL_WIDTH)}${this.numIntrinsic}
${'Constructor function'.padEnd(LABEL_WIDTH)}${this.numConstructor}
${'Virtual function'.padEnd(LABEL_WIDTH)}${this.numVirtual}
${'Blank function'.padEnd(LABEL_WIDTH)}${this.numBlank}
${'Total'.padEnd(LABEL_WIDTH)}${this.numTotalNode}`;
    }
}
exports.CGStat = CGStat;
