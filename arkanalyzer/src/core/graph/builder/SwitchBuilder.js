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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwitchBuilder = void 0;
const BasicBlock_1 = require("../BasicBlock");
const CfgBuilder_1 = require("./CfgBuilder");
const logger_1 = __importStar(require("../../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SwitchBuilder');
/**
 * Builder for switch statement in CFG
 */
class SwitchBuilder {
    buildSwitch(blockBuilderToCfgBlock, blockBuildersContainSwitch, valueAndStmtsOfSwitchAndCasesAll, arkIRTransformer, basicBlockSet) {
        for (let i = 0; i < blockBuildersContainSwitch.length; i++) {
            const blockBuilderContainSwitch = blockBuildersContainSwitch[i];
            if (!blockBuilderToCfgBlock.has(blockBuilderContainSwitch)) {
                logger.error(`can't find basicBlock corresponding to the blockBuilder.`);
                continue;
            }
            const blockContainSwitch = blockBuilderToCfgBlock.get(blockBuilderContainSwitch);
            const valueAndStmtsOfSwitch = valueAndStmtsOfSwitchAndCasesAll[i][0];
            const stmtsOfSwitch = valueAndStmtsOfSwitch.stmts;
            stmtsOfSwitch.forEach((stmt) => {
                blockContainSwitch.addStmt(stmt);
            });
            const stmtsCnt = blockBuilderContainSwitch.stmts.length;
            const switchStmtBuilder = blockBuilderContainSwitch.stmts[stmtsCnt - 1];
            const cases = switchStmtBuilder.cases;
            let nonEmptyCaseCnt = 0;
            for (const currCase of cases) {
                if (currCase.stmt.block) {
                    // there are stmts after this case
                    nonEmptyCaseCnt++;
                }
            }
            if (nonEmptyCaseCnt === 0) {
                continue;
            }
            const caseCnt = cases.length;
            const caseIfBlocks = this.generateIfBlocksForCases(valueAndStmtsOfSwitchAndCasesAll[i], caseCnt, blockContainSwitch, basicBlockSet, arkIRTransformer);
            this.linkIfBlockAndCaseBlock(blockContainSwitch, caseIfBlocks, switchStmtBuilder, blockBuilderToCfgBlock);
        }
    }
    generateIfBlocksForCases(valueAndStmtsOfSwitchAndCases, caseCnt, blockContainSwitch, basicBlockSet, arkIRTransformer) {
        const valueAndStmtsOfSwitch = valueAndStmtsOfSwitchAndCases[0];
        const valueOfSwitch = valueAndStmtsOfSwitch.value;
        const caseIfBlocks = [];
        for (let j = 0; j < caseCnt; j++) {
            let caseIfBlock;
            if (j === 0) {
                caseIfBlock = blockContainSwitch;
            }
            else {
                caseIfBlock = new BasicBlock_1.BasicBlock();
                basicBlockSet.add(caseIfBlock);
            }
            caseIfBlocks.push(caseIfBlock);
            const caseValueAndStmts = valueAndStmtsOfSwitchAndCases[j + 1];
            const caseValue = caseValueAndStmts.value;
            const caseStmts = caseValueAndStmts.stmts;
            caseStmts.forEach((stmt) => {
                caseIfBlock.addStmt(stmt);
            });
            const caseIfStmts = arkIRTransformer.generateIfStmtForValues(valueOfSwitch, valueAndStmtsOfSwitch.valueOriginalPositions, caseValue, caseValueAndStmts.valueOriginalPositions);
            caseIfStmts.forEach((stmt) => {
                caseIfBlock.addStmt(stmt);
            });
        }
        return caseIfBlocks;
    }
    linkIfBlockAndCaseBlock(blockContainSwitch, caseIfBlocks, switchStmtBuilder, blockBuilderToCfgBlock) {
        const successorsOfBlockContainSwitch = Array.from(blockContainSwitch.getSuccessors());
        const expectedSuccessorsOfCaseIfBlock = [];
        const defaultStmtBuilder = switchStmtBuilder.default;
        if (defaultStmtBuilder && defaultStmtBuilder.block) {
            expectedSuccessorsOfCaseIfBlock.push(...successorsOfBlockContainSwitch.splice(-1, 1));
        }
        else {
            const afterSwitchStmtBuilder = switchStmtBuilder.afterSwitch;
            const afterSwitchBlockBuilder = afterSwitchStmtBuilder?.block;
            if (!afterSwitchBlockBuilder || !blockBuilderToCfgBlock.has(afterSwitchBlockBuilder)) {
                logger.error(`can't find basicBlock corresponding to the blockBuilder.`);
                return false;
            }
            expectedSuccessorsOfCaseIfBlock.push(blockBuilderToCfgBlock.get(afterSwitchBlockBuilder));
        }
        const caseCnt = switchStmtBuilder.cases.length;
        for (let i = caseCnt - 1; i >= 0; i--) {
            const currCase = switchStmtBuilder.cases[i];
            if (currCase.stmt.block) {
                expectedSuccessorsOfCaseIfBlock.push(...successorsOfBlockContainSwitch.splice(-1, 1));
            }
            else {
                // if there are no stmts after this case, reuse the successor of the next case
                expectedSuccessorsOfCaseIfBlock.push(...expectedSuccessorsOfCaseIfBlock.slice(-1));
            }
        }
        expectedSuccessorsOfCaseIfBlock.reverse();
        CfgBuilder_1.CfgBuilder.unlinkSuccessorsOfBasicBlock(blockContainSwitch);
        for (let j = 0; j < caseCnt; j++) {
            const trueBranchBlock = expectedSuccessorsOfCaseIfBlock[j];
            const falseBranchBlock = j === caseCnt - 1 ? expectedSuccessorsOfCaseIfBlock[j + 1] : caseIfBlocks[j + 1];
            const caseIfBlock = caseIfBlocks[j];
            CfgBuilder_1.CfgBuilder.linkSuccessorOfIfBasicBlock(caseIfBlock, trueBranchBlock, falseBranchBlock);
        }
        return true;
    }
}
exports.SwitchBuilder = SwitchBuilder;
//# sourceMappingURL=SwitchBuilder.js.map