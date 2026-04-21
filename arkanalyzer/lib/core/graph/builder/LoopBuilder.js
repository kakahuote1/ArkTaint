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
exports.LoopBuilder = void 0;
const BasicBlock_1 = require("../BasicBlock");
const Stmt_1 = require("../../base/Stmt");
const Expr_1 = require("../../base/Expr");
const Builtin_1 = require("../../common/Builtin");
const ArkIRTransformer_1 = require("../../common/ArkIRTransformer");
const CfgBuilder_1 = require("./CfgBuilder");
/**
 * Builder for loop in CFG
 */
class LoopBuilder {
    rebuildBlocksInLoop(blockBuilderToCfgBlock, blocksContainLoopCondition, basicBlockSet, blockBuilders) {
        for (const blockBuilder of blocksContainLoopCondition) {
            if (!blockBuilderToCfgBlock.get(blockBuilder)) {
                continue;
            }
            const block = blockBuilderToCfgBlock.get(blockBuilder);
            const blockId = block.getId();
            const stmts = block.getStmts();
            const stmtsCnt = stmts.length;
            const { ifStmtIdx, iteratorNextStmtIdx, dummyInitializerStmtIdx } = this.findIteratorIdx(stmts);
            if (iteratorNextStmtIdx !== -1 || dummyInitializerStmtIdx !== -1) {
                const lastStmtIdxBeforeCondition = iteratorNextStmtIdx !== -1 ? iteratorNextStmtIdx : dummyInitializerStmtIdx;
                const stmtsInsertBeforeCondition = stmts.slice(0, lastStmtIdxBeforeCondition);
                // If the loop body is empty, the loop conditional block should contain its own
                const emptyLoopBody = blockBuilder.nexts.length === 1;
                if (emptyLoopBody) {
                    blockBuilder.nexts.splice(0, 0, blockBuilder);
                    blockBuilder.lasts.push(blockBuilder);
                    block.getSuccessors().splice(0, 0, block);
                    block.addPredecessorBlock(block);
                }
                let prevBlockBuilderContainsLoop = this.doesPrevBlockBuilderContainLoop(blockBuilder, blockId, blocksContainLoopCondition);
                if (prevBlockBuilderContainsLoop) {
                    // should create an extra block when previous block contains loop condition
                    this.insertBeforeConditionBlockBuilder(blockBuilderToCfgBlock, blockBuilder, stmtsInsertBeforeCondition, false, basicBlockSet, blockBuilders);
                }
                else {
                    const blockBuilderBeforeCondition = blockBuilder.lasts[0];
                    const blockBeforeCondition = blockBuilderToCfgBlock.get(blockBuilderBeforeCondition);
                    stmtsInsertBeforeCondition.forEach(stmt => blockBeforeCondition === null || blockBeforeCondition === void 0 ? void 0 : blockBeforeCondition.getStmts().push(stmt));
                }
                if (dummyInitializerStmtIdx !== -1 && ifStmtIdx !== stmtsCnt - 1) {
                    // put incrementor statements into block which reenters condition
                    this.adjustIncrementorStmts(stmts, ifStmtIdx, blockBuilder, blockId, blockBuilderToCfgBlock, blocksContainLoopCondition, basicBlockSet, emptyLoopBody, blockBuilders);
                }
                else if (iteratorNextStmtIdx !== -1) {
                    // put statements which get value of iterator into block after condition
                    const blockBuilderAfterCondition = blockBuilder.nexts[0];
                    const blockAfterCondition = blockBuilderToCfgBlock.get(blockBuilderAfterCondition);
                    const stmtsAfterCondition = stmts.slice(ifStmtIdx + 1);
                    blockAfterCondition === null || blockAfterCondition === void 0 ? void 0 : blockAfterCondition.getStmts().splice(0, 0, ...stmtsAfterCondition);
                }
                // remove statements which should not in condition
                const firstStmtIdxInCondition = iteratorNextStmtIdx !== -1 ? iteratorNextStmtIdx : dummyInitializerStmtIdx + 1;
                stmts.splice(0, firstStmtIdxInCondition);
                stmts.splice(ifStmtIdx - firstStmtIdxInCondition + 1);
            }
        }
    }
    doesPrevBlockBuilderContainLoop(currBlockBuilder, currBlockId, blocksContainLoopCondition) {
        let prevBlockBuilderContainsLoop = false;
        for (const prevBlockBuilder of currBlockBuilder.lasts) {
            if (prevBlockBuilder.id < currBlockId && blocksContainLoopCondition.has(prevBlockBuilder)) {
                prevBlockBuilderContainsLoop = true;
                break;
            }
        }
        return prevBlockBuilderContainsLoop;
    }
    insertBeforeConditionBlockBuilder(blockBuilderToCfgBlock, conditionBlockBuilder, stmtsInsertBeforeCondition, collectReenter, basicBlockSet, blockBuilders) {
        if (stmtsInsertBeforeCondition.length === 0) {
            return;
        }
        const blockId = conditionBlockBuilder.id;
        const block = this.getBlockFromMap(blockBuilderToCfgBlock, conditionBlockBuilder);
        const { blockBuildersBeforeCondition, blocksBeforeCondition, blockBuildersReenterCondition, blocksReenterCondition } = this.collectBlocksBeforeAndReenter(blockBuilderToCfgBlock, conditionBlockBuilder, blockId);
        const { collectedBlockBuilders, collectedBlocks } = this.getCollectedBlocks(collectReenter, blockBuildersBeforeCondition, blocksBeforeCondition, blockBuildersReenterCondition, blocksReenterCondition);
        const { blockBuilderInsertBeforeCondition, blockInsertBeforeCondition } = this.createAndLinkBlocks(collectedBlockBuilders, collectedBlocks, conditionBlockBuilder, stmtsInsertBeforeCondition, block);
        this.updatePredecessors(collectedBlockBuilders, blockBuilderToCfgBlock, conditionBlockBuilder, blockBuilderInsertBeforeCondition, blockInsertBeforeCondition);
        const { newPrevBlockBuildersBeforeCondition, newPrevBlocksBeforeCondition } = this.getNewPrevBlocks(collectReenter, blockBuildersBeforeCondition, blocksBeforeCondition, blockBuilderInsertBeforeCondition, blockInsertBeforeCondition, blockBuildersReenterCondition, blocksReenterCondition);
        this.updateConditionBlockBuilder(conditionBlockBuilder, newPrevBlockBuildersBeforeCondition, block, newPrevBlocksBeforeCondition);
        this.finalizeInsertion(blockBuilderInsertBeforeCondition, blockInsertBeforeCondition, basicBlockSet, blockBuilderToCfgBlock, blockBuilders);
    }
    getBlockFromMap(blockBuilderToCfgBlock, conditionBlockBuilder) {
        return blockBuilderToCfgBlock.get(conditionBlockBuilder);
    }
    collectBlocksBeforeAndReenter(blockBuilderToCfgBlock, conditionBlockBuilder, blockId) {
        const blockBuildersBeforeCondition = [];
        const blocksBeforeCondition = [];
        const blockBuildersReenterCondition = [];
        const blocksReenterCondition = [];
        for (const prevBlockBuilder of conditionBlockBuilder.lasts) {
            const prevBlock = blockBuilderToCfgBlock.get(prevBlockBuilder);
            if (prevBlock.getId() < blockId) {
                blockBuildersBeforeCondition.push(prevBlockBuilder);
                blocksBeforeCondition.push(prevBlock);
            }
            else {
                blockBuildersReenterCondition.push(prevBlockBuilder);
                blocksReenterCondition.push(prevBlock);
            }
        }
        return {
            blockBuildersBeforeCondition,
            blocksBeforeCondition,
            blockBuildersReenterCondition,
            blocksReenterCondition,
        };
    }
    getCollectedBlocks(collectReenter, blockBuildersBeforeCondition, blocksBeforeCondition, blockBuildersReenterCondition, blocksReenterCondition) {
        let collectedBlockBuilders = [];
        let collectedBlocks = [];
        if (collectReenter) {
            collectedBlockBuilders = blockBuildersReenterCondition;
            collectedBlocks = blocksReenterCondition;
        }
        else {
            collectedBlockBuilders = blockBuildersBeforeCondition;
            collectedBlocks = blocksBeforeCondition;
        }
        return { collectedBlockBuilders, collectedBlocks };
    }
    createAndLinkBlocks(collectedBlockBuilders, collectedBlocks, conditionBlockBuilder, stmtsInsertBeforeCondition, block) {
        const blockBuilderInsertBeforeCondition = new CfgBuilder_1.BlockBuilder(-1, []);
        blockBuilderInsertBeforeCondition.lasts.push(...collectedBlockBuilders);
        blockBuilderInsertBeforeCondition.nexts.push(conditionBlockBuilder);
        const blockInsertBeforeCondition = new BasicBlock_1.BasicBlock();
        stmtsInsertBeforeCondition.forEach(stmt => blockInsertBeforeCondition.getStmts().push(stmt));
        blockInsertBeforeCondition.getPredecessors().push(...collectedBlocks);
        blockInsertBeforeCondition.addSuccessorBlock(block);
        return { blockBuilderInsertBeforeCondition, blockInsertBeforeCondition };
    }
    updatePredecessors(collectedBlockBuilders, blockBuilderToCfgBlock, conditionBlockBuilder, blockBuilderInsertBeforeCondition, blockInsertBeforeCondition) {
        for (const prevBlockBuilder of collectedBlockBuilders) {
            const prevBlock = blockBuilderToCfgBlock.get(prevBlockBuilder);
            for (let j = 0; j < prevBlockBuilder.nexts.length; j++) {
                if (prevBlockBuilder.nexts[j] === conditionBlockBuilder) {
                    prevBlockBuilder.nexts[j] = blockBuilderInsertBeforeCondition;
                    prevBlock.setSuccessorBlock(j, blockInsertBeforeCondition);
                    break;
                }
            }
        }
    }
    getNewPrevBlocks(collectReenter, blockBuildersBeforeCondition, blocksBeforeCondition, blockBuilderInsertBeforeCondition, blockInsertBeforeCondition, blockBuildersReenterCondition, blocksReenterCondition) {
        let newPrevBlockBuildersBeforeCondition = [];
        let newPrevBlocksBeforeCondition = [];
        if (collectReenter) {
            newPrevBlockBuildersBeforeCondition = [...blockBuildersBeforeCondition, blockBuilderInsertBeforeCondition];
            newPrevBlocksBeforeCondition = [...blocksBeforeCondition, blockInsertBeforeCondition];
        }
        else {
            newPrevBlockBuildersBeforeCondition = [blockBuilderInsertBeforeCondition, ...blockBuildersReenterCondition];
            newPrevBlocksBeforeCondition = [blockInsertBeforeCondition, ...blocksReenterCondition];
        }
        return {
            newPrevBlockBuildersBeforeCondition,
            newPrevBlocksBeforeCondition,
        };
    }
    updateConditionBlockBuilder(conditionBlockBuilder, newPrevBlockBuildersBeforeCondition, block, newPrevBlocksBeforeCondition) {
        conditionBlockBuilder.lasts = newPrevBlockBuildersBeforeCondition;
        const predecessorsCnt = block.getPredecessors().length;
        block.getPredecessors().splice(0, predecessorsCnt, ...newPrevBlocksBeforeCondition);
    }
    finalizeInsertion(blockBuilderInsertBeforeCondition, blockInsertBeforeCondition, basicBlockSet, blockBuilderToCfgBlock, blockBuilders) {
        blockBuilders.push(blockBuilderInsertBeforeCondition);
        basicBlockSet.add(blockInsertBeforeCondition);
        blockBuilderToCfgBlock.set(blockBuilderInsertBeforeCondition, blockInsertBeforeCondition);
    }
    findIteratorIdx(stmts) {
        let ifStmtIdx = -1;
        let iteratorNextStmtIdx = -1;
        let dummyInitializerStmtIdx = -1;
        const stmtsCnt = stmts.length;
        for (let i = 0; i < stmtsCnt; i++) {
            const stmt = stmts[i];
            if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Expr_1.AbstractInvokeExpr) {
                const invokeExpr = stmt.getRightOp();
                if (invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() === Builtin_1.Builtin.ITERATOR_NEXT) {
                    iteratorNextStmtIdx = i;
                    continue;
                }
            }
            if (stmt.toString() === ArkIRTransformer_1.ArkIRTransformer.DUMMY_LOOP_INITIALIZER_STMT) {
                dummyInitializerStmtIdx = i;
                continue;
            }
            if (stmt instanceof Stmt_1.ArkIfStmt) {
                ifStmtIdx = i;
                break;
            }
        }
        return {
            ifStmtIdx: ifStmtIdx,
            iteratorNextStmtIdx: iteratorNextStmtIdx,
            dummyInitializerStmtIdx: dummyInitializerStmtIdx,
        };
    }
    adjustIncrementorStmts(stmts, ifStmtIdx, currBlockBuilder, currBlockId, blockBuilderToCfgBlock, blocksContainLoopCondition, basicBlockSet, emptyLoopBody, blockBuilders) {
        const stmtsReenterCondition = stmts.slice(ifStmtIdx + 1);
        if (emptyLoopBody) {
            const incrementorBlockBuilder = new CfgBuilder_1.BlockBuilder(-1, []);
            incrementorBlockBuilder.lasts.push(currBlockBuilder);
            currBlockBuilder.nexts[0] = incrementorBlockBuilder;
            incrementorBlockBuilder.nexts.push(currBlockBuilder);
            currBlockBuilder.lasts[1] = incrementorBlockBuilder;
            const incrementorBlock = new BasicBlock_1.BasicBlock();
            blockBuilderToCfgBlock.set(incrementorBlockBuilder, incrementorBlock);
            stmtsReenterCondition.forEach(stmt => incrementorBlock.getStmts().push(stmt));
            const currBlock = blockBuilderToCfgBlock.get(currBlockBuilder);
            incrementorBlock.getPredecessors().push(currBlock);
            currBlock.setPredecessorBlock(1, incrementorBlock);
            incrementorBlock.addSuccessorBlock(currBlock);
            currBlock.setSuccessorBlock(0, incrementorBlock);
            basicBlockSet.add(incrementorBlock);
            return;
        }
        const blockBuildersReenterCondition = [];
        for (const prevBlockBuilder of currBlockBuilder.lasts) {
            const prevBlock = blockBuilderToCfgBlock.get(prevBlockBuilder);
            if (prevBlock.getId() > currBlockId) {
                blockBuildersReenterCondition.push(prevBlockBuilder);
            }
        }
        if (blockBuildersReenterCondition.length > 1 ||
            blockBuildersReenterCondition[0].nexts.length > 1 ||
            blocksContainLoopCondition.has(blockBuildersReenterCondition[0])) {
            // put incrementor statements into an extra block
            this.insertBeforeConditionBlockBuilder(blockBuilderToCfgBlock, currBlockBuilder, stmtsReenterCondition, true, basicBlockSet, blockBuilders);
        }
        else {
            // put incrementor statements into prev reenter block
            const blockReenterCondition = blockBuilderToCfgBlock.get(blockBuildersReenterCondition[0]);
            stmtsReenterCondition.forEach(stmt => blockReenterCondition === null || blockReenterCondition === void 0 ? void 0 : blockReenterCondition.getStmts().push(stmt));
        }
    }
}
exports.LoopBuilder = LoopBuilder;
