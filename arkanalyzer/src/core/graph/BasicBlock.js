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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasicBlock = void 0;
const Stmt_1 = require("../base/Stmt");
const ArkError_1 = require("../common/ArkError");
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'BasicBlock');
/**
 * @category core/graph
 * A `BasicBlock` is composed of:
 * - ID: a **number** that uniquely identify the basic block, initialized as -1.
 * - Statements: an **array** of statements in the basic block.
 * - Predecessors:  an **array** of basic blocks in front of the current basic block. More accurately, these basic
 *     blocks can reach the current block through edges.
 * - Successors: an **array** of basic blocks after the current basic block. More accurately, the current block can
 *     reach these basic blocks through edges.
 */
class BasicBlock {
    constructor() {
        this.id = -1;
        this.stmts = [];
        this.predecessorBlocks = [];
        this.successorBlocks = [];
    }
    getId() {
        return this.id;
    }
    setId(id) {
        this.id = id;
    }
    /**
     * Returns an array of the statements in a basic block.
     * @returns An array of statements in a basic block.
     */
    getStmts() {
        return this.stmts;
    }
    addStmt(stmt) {
        this.stmts.push(stmt);
    }
    /**
     * Adds the given stmt at the beginning of the basic block.
     * @param stmt
     */
    addHead(stmt) {
        if (stmt instanceof Stmt_1.Stmt) {
            this.stmts.unshift(stmt);
        }
        else {
            this.stmts.unshift(...stmt);
        }
    }
    /**
     * Adds the given stmt at the end of the basic block.
     * @param stmt
     */
    addTail(stmt) {
        if (stmt instanceof Stmt_1.Stmt) {
            this.stmts.push(stmt);
        }
        else {
            stmt.forEach(stmt => this.stmts.push(stmt));
        }
    }
    /**
     * Inserts toInsert in the basic block after point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertAfter(toInsert, point) {
        let index = this.stmts.indexOf(point);
        if (index < 0) {
            return 0;
        }
        return this.insertPos(index + 1, toInsert);
    }
    /**
     * Inserts toInsert in the basic block befor point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertBefore(toInsert, point) {
        let index = this.stmts.indexOf(point);
        if (index < 0) {
            return 0;
        }
        return this.insertPos(index, toInsert);
    }
    /**
     * Removes the given stmt from this basic block.
     * @param stmt
     * @returns
     */
    remove(stmt) {
        let index = this.stmts.indexOf(stmt);
        if (index < 0) {
            return;
        }
        this.stmts.splice(index, 1);
    }
    /**
     * Removes the first stmt from this basic block.
     */
    removeHead() {
        this.stmts.splice(0, 1);
    }
    /**
     * Removes the last stmt from this basic block.
     */
    removeTail() {
        this.stmts.splice(this.stmts.length - 1, 1);
    }
    getHead() {
        const stmts = this.getStmts();
        if (stmts.length === 0) {
            return null;
        }
        return stmts[0];
    }
    getTail() {
        const stmts = this.getStmts();
        let size = stmts.length;
        if (size === 0) {
            return null;
        }
        return stmts[size - 1];
    }
    /**
     * Returns successors of the current basic block, whose types are also basic blocks (i.e.{@link BasicBlock}).
     * @returns Successors of the current basic block.
     * @example
     * 1. get block successors.

    ```typescript
    const body = arkMethod.getBody();
    const blocks = [...body.getCfg().getBlocks()]
    for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
        ...
        for (const next of block.getSuccessors()) {
        ...
        }
    }
    ```
     */
    getSuccessors() {
        return this.successorBlocks;
    }
    /**
     * Returns predecessors of the current basic block, whose types are also basic blocks.
     * @returns An array of basic blocks.
     */
    getPredecessors() {
        return this.predecessorBlocks;
    }
    addPredecessorBlock(block) {
        this.predecessorBlocks.push(block);
    }
    setPredecessorBlock(idx, block) {
        if (idx < this.predecessorBlocks.length) {
            this.predecessorBlocks[idx] = block;
            return true;
        }
        return false;
    }
    setSuccessorBlock(idx, block) {
        if (idx < this.successorBlocks.length) {
            this.successorBlocks[idx] = block;
            return true;
        }
        return false;
    }
    // Temp just for SSA
    addStmtToFirst(stmt) {
        this.addHead(stmt);
    }
    // Temp just for SSA
    addSuccessorBlock(block) {
        this.successorBlocks.push(block);
    }
    removePredecessorBlock(block) {
        let index = this.predecessorBlocks.indexOf(block);
        if (index < 0) {
            return false;
        }
        this.predecessorBlocks.splice(index, 1);
        return true;
    }
    removeSuccessorBlock(block) {
        let index = this.successorBlocks.indexOf(block);
        if (index < 0) {
            return false;
        }
        this.successorBlocks.splice(index, 1);
        return true;
    }
    toString() {
        let strs = [];
        for (const stmt of this.stmts) {
            strs.push(stmt.toString() + '\n');
        }
        return strs.join('');
    }
    validate() {
        let branchStmts = [];
        for (const stmt of this.stmts) {
            if (stmt instanceof Stmt_1.ArkIfStmt || stmt instanceof Stmt_1.ArkReturnStmt || stmt instanceof Stmt_1.ArkReturnVoidStmt) {
                branchStmts.push(stmt);
            }
        }
        if (branchStmts.length > 1) {
            let errMsg = `More than one branch or return stmts in the block: ${branchStmts.map(value => value.toString()).join('\n')}`;
            logger.error(errMsg);
            return {
                errCode: ArkError_1.ArkErrorCode.BB_MORE_THAN_ONE_BRANCH_RET_STMT,
                errMsg: errMsg,
            };
        }
        if (branchStmts.length === 1 && branchStmts[0] !== this.stmts[this.stmts.length - 1]) {
            let errMsg = `${branchStmts[0].toString()} not at the end of block.`;
            logger.error(errMsg);
            return {
                errCode: ArkError_1.ArkErrorCode.BB_BRANCH_RET_STMT_NOT_AT_END,
                errMsg: errMsg,
            };
        }
        return { errCode: ArkError_1.ArkErrorCode.OK };
    }
    insertPos(index, toInsert) {
        if (toInsert instanceof Stmt_1.Stmt) {
            this.stmts.splice(index, 0, toInsert);
            return 1;
        }
        this.stmts.splice(index, 0, ...toInsert);
        return toInsert.length;
    }
    getExceptionalSuccessorBlocks() {
        return this.exceptionalSuccessorBlocks;
    }
    getExceptionalPredecessorBlocks() {
        return this.exceptionalPredecessorBlocks;
    }
    addExceptionalPredecessorBlock(block) {
        if (!this.exceptionalPredecessorBlocks) {
            this.exceptionalPredecessorBlocks = [];
        }
        this.exceptionalPredecessorBlocks.push(block);
    }
    addExceptionalSuccessorBlock(block) {
        if (!this.exceptionalSuccessorBlocks) {
            this.exceptionalSuccessorBlocks = [];
        }
        this.exceptionalSuccessorBlocks.push(block);
    }
}
exports.BasicBlock = BasicBlock;
//# sourceMappingURL=BasicBlock.js.map