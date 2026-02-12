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
exports.Cfg = void 0;
const DefUseChain_1 = require("../base/DefUseChain");
const Local_1 = require("../base/Local");
const Stmt_1 = require("../base/Stmt");
const ArkError_1 = require("../common/ArkError");
const ArkMethod_1 = require("../model/ArkMethod");
const logger_1 = __importStar(require("../../utils/logger"));
const Expr_1 = require("../base/Expr");
const ValueAsserts_1 = require("../../utils/ValueAsserts");
const Ref_1 = require("../base/Ref");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'BasicBlock');
/**
 * @category core/graph
 */
class Cfg {
    constructor() {
        this.blocks = new Set();
        this.stmtToBlock = new Map();
        this.defUseChains = [];
        this.declaringMethod = new ArkMethod_1.ArkMethod();
    }
    getStmtToBlock() {
        return this.stmtToBlock;
    }
    getStmts() {
        let stmts = new Array();
        for (const block of this.blocks) {
            block.getStmts().forEach(s => stmts.push(s));
        }
        return stmts;
    }
    /**
     * Inserts toInsert in the basic block in CFG after point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertAfter(toInsert, point) {
        const block = this.stmtToBlock.get(point);
        if (!block) {
            return 0;
        }
        this.updateStmt2BlockMap(block, toInsert);
        return block.insertAfter(toInsert, point);
    }
    /**
     * Inserts toInsert in the basic block in CFG befor point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertBefore(toInsert, point) {
        const block = this.stmtToBlock.get(point);
        if (!block) {
            return 0;
        }
        this.updateStmt2BlockMap(block, toInsert);
        return block.insertBefore(toInsert, point);
    }
    /**
     * Removes the given stmt from the basic block in CFG.
     * @param stmt
     * @returns
     */
    remove(stmt) {
        const block = this.stmtToBlock.get(stmt);
        if (!block) {
            return;
        }
        this.stmtToBlock.delete(stmt);
        block.remove(stmt);
    }
    /**
     * Update stmtToBlock Map
     * @param block
     * @param changed
     */
    updateStmt2BlockMap(block, changed) {
        if (!changed) {
            for (const stmt of block.getStmts()) {
                this.stmtToBlock.set(stmt, block);
            }
        }
        else if (changed instanceof Stmt_1.Stmt) {
            this.stmtToBlock.set(changed, block);
        }
        else {
            for (const insert of changed) {
                this.stmtToBlock.set(insert, block);
            }
        }
    }
    // TODO: 添加block之间的边
    addBlock(block) {
        this.blocks.add(block);
        for (const stmt of block.getStmts()) {
            this.stmtToBlock.set(stmt, block);
        }
    }
    setBlocks(blocks, resetStmtToBlock = true) {
        this.blocks = blocks;
        if (resetStmtToBlock) {
            this.stmtToBlock.clear();
            for (const block of this.blocks) {
                for (const stmt of block.getStmts()) {
                    this.stmtToBlock.set(stmt, block);
                }
            }
        }
    }
    /**
     * Get all basic blocks with topological order.
     * @returns The set of all basic blocks.
     */
    getBlocks() {
        return this.blocks;
    }
    getStartingBlock() {
        const startingBlock = this.stmtToBlock.get(this.startingStmt);
        ValueAsserts_1.ValueAsserts.assertDefined(startingBlock, 'starting block getting with starting stmt is undefined');
        return startingBlock;
    }
    getStartingStmt() {
        return this.startingStmt;
    }
    setStartingStmt(newStartingStmt) {
        this.startingStmt = newStartingStmt;
    }
    getDeclaringMethod() {
        return this.declaringMethod;
    }
    setDeclaringMethod(method) {
        this.declaringMethod = method;
    }
    getDefUseChains() {
        return this.defUseChains;
    }
    // TODO: 整理成类似jimple的输出
    toString() {
        return 'cfg';
    }
    // 若提供globals列表，则需要将locals中实际为global的部分排除，否则会在该method中将为global赋值的语句识别成global的赋值语句，出现错误
    buildDefUseStmt(locals, globals) {
        for (const stmt of this.getStmts()) {
            for (const value of stmt.getUses()) {
                this.buildUseStmt(value, locals, stmt);
            }
            const defValue = stmt.getDef();
            if (!(defValue instanceof Local_1.Local)) {
                continue;
            }
            if (globals !== undefined && globals.has(defValue.getName())) {
                // local实际为global，其实际定义语句在最外层default方法中，此处不存在定义语句
                continue;
            }
            if (defValue.getDeclaringStmt() === null) {
                defValue.setDeclaringStmt(stmt);
            }
        }
    }
    buildUseStmt(value, locals, stmt) {
        if (value instanceof Local_1.Local) {
            value.addUsedStmt(stmt);
        }
        else if (value instanceof Expr_1.ArkStaticInvokeExpr) {
            for (let local of locals) {
                if (local.getName() === value.getMethodSignature().getMethodSubSignature().getMethodName()) {
                    local.addUsedStmt(stmt);
                    return;
                }
            }
        }
        else if (value instanceof Ref_1.AbstractFieldRef) {
            // here is used for adding this stmt to array/tuple index local, such as a = arr[i]
            for (const local of locals) {
                if (local.getName() === value.getFieldName()) {
                    local.addUsedStmt(stmt);
                    return;
                }
            }
        }
    }
    handleDefUseForValue(value, block, stmt, stmtIndex) {
        const name = value.toString();
        const defStmts = [];
        // 判断本block之前有无对应def
        for (let i = stmtIndex - 1; i >= 0; i--) {
            const beforeStmt = block.getStmts()[i];
            if (beforeStmt.getDef() && beforeStmt.getDef()?.toString() === name) {
                defStmts.push(beforeStmt);
                break;
            }
        }
        // 本block有对应def直接结束,否则找所有的前序block
        if (defStmts.length !== 0) {
            this.defUseChains.push(new DefUseChain_1.DefUseChain(value, defStmts[0], stmt));
            return;
        }
        const needWalkBlocks = [...block.getPredecessors()];
        const walkedBlocks = new Set();
        while (needWalkBlocks.length > 0) {
            const predecessor = needWalkBlocks.pop();
            if (!predecessor) {
                return;
            }
            const predecessorStmts = predecessor.getStmts();
            let predecessorHasDef = false;
            for (let i = predecessorStmts.length - 1; i >= 0; i--) {
                const beforeStmt = predecessorStmts[i];
                if (beforeStmt.getDef() && beforeStmt.getDef()?.toString() === name) {
                    defStmts.push(beforeStmt);
                    predecessorHasDef = true;
                    break;
                }
            }
            walkedBlocks.add(predecessor);
            if (predecessorHasDef) {
                continue;
            }
            for (const morePredecessor of predecessor.getPredecessors()) {
                if (!walkedBlocks.has(morePredecessor) && !needWalkBlocks.includes(morePredecessor)) {
                    needWalkBlocks.unshift(morePredecessor);
                }
            }
        }
        for (const def of defStmts) {
            this.defUseChains.push(new DefUseChain_1.DefUseChain(value, def, stmt));
        }
    }
    buildDefUseChain() {
        for (const block of this.blocks) {
            for (let stmtIndex = 0; stmtIndex < block.getStmts().length; stmtIndex++) {
                const stmt = block.getStmts()[stmtIndex];
                for (const value of stmt.getUses()) {
                    this.handleDefUseForValue(value, block, stmt, stmtIndex);
                }
            }
        }
    }
    getUnreachableBlocks() {
        let unreachable = new Set();
        let startBB = this.getStartingBlock();
        if (!startBB) {
            return unreachable;
        }
        let postOrder = this.dfsPostOrder(startBB);
        for (const bb of this.blocks) {
            if (!postOrder.has(bb)) {
                unreachable.add(bb);
            }
        }
        return unreachable;
    }
    validate() {
        let startBB = this.getStartingBlock();
        if (!startBB) {
            let errMsg = `Not found starting block}`;
            logger.error(errMsg);
            return {
                errCode: ArkError_1.ArkErrorCode.CFG_NOT_FOUND_START_BLOCK,
                errMsg: errMsg,
            };
        }
        let unreachable = this.getUnreachableBlocks();
        if (unreachable.size !== 0) {
            let errMsg = `Unreachable blocks: ${Array.from(unreachable)
                .map(value => value.toString())
                .join('\n')}`;
            logger.error(errMsg);
            return {
                errCode: ArkError_1.ArkErrorCode.CFG_HAS_UNREACHABLE_BLOCK,
                errMsg: errMsg,
            };
        }
        return { errCode: ArkError_1.ArkErrorCode.OK };
    }
    dfsPostOrder(node, visitor = new Set(), postOrder = new Set()) {
        visitor.add(node);
        for (const succ of node.getSuccessors()) {
            if (visitor.has(succ)) {
                continue;
            }
            this.dfsPostOrder(succ, visitor, postOrder);
        }
        postOrder.add(node);
        return postOrder;
    }
}
exports.Cfg = Cfg;
//# sourceMappingURL=Cfg.js.map