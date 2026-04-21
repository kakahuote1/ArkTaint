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
exports.StmtReader = exports.SourceBody = void 0;
const Local_1 = require("../../core/base/Local");
const Stmt_1 = require("../../core/base/Stmt");
const logger_1 = __importStar(require("../../utils/logger"));
const ArkStream_1 = require("../ArkStream");
const SourceStmt_1 = require("./SourceStmt");
const CfgStructualAnalysis_1 = require("../../utils/CfgStructualAnalysis");
const ModelUtils_1 = require("../../core/common/ModelUtils");
const PrinterUtils_1 = require("../base/PrinterUtils");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SourceBody');
class SourceBody {
    constructor(indent, method, inBuilder) {
        this.stmts = [];
        this.printer = new ArkStream_1.ArkCodeBuffer(indent);
        this.method = method;
        this.arkBody = method.getBody();
        this.cfgUtils = new CfgStructualAnalysis_1.AbstractFlowGraph(method.getCfg(), this.arkBody.getTraps());
        this.tempCodeMap = new Map();
        this.tempVisitor = new Set();
        this.definedLocals = new Set();
        this.inBuilder = inBuilder;
        this.skipStmts = new Set();
        this.stmtReader = new StmtReader([]);
        this.lastStmt = this.arkBody.getCfg().getStartingStmt();
        this.buildSourceStmt();
    }
    setSkipStmt(stmt) {
        this.skipStmts.add(stmt);
    }
    isInBuilderMethod() {
        return this.inBuilder;
    }
    isInDefaultMethod() {
        return this.method.isDefaultArkMethod();
    }
    getArkFile() {
        return this.method.getDeclaringArkFile();
    }
    getDeclaringArkNamespace() {
        return this.method.getDeclaringArkClass().getDeclaringArkNamespace();
    }
    getMethod(signature) {
        let method = this.method.getDeclaringArkFile().getScene().getMethod(signature);
        if (method) {
            return method;
        }
        return this.method.getDeclaringArkClass().getMethodWithName(signature.getMethodSubSignature().getMethodName());
    }
    getClass(signature) {
        return ModelUtils_1.ModelUtils.getClass(this.method, signature);
    }
    getLocals() {
        return this.arkBody.getLocals();
    }
    defineLocal(local) {
        this.definedLocals.add(local);
    }
    isLocalDefined(local) {
        return this.definedLocals.has(local);
    }
    getStmtReader() {
        return this.stmtReader;
    }
    setTempCode(temp, code) {
        this.tempCodeMap.set(temp, code);
    }
    transTemp2Code(temp, isLeftOp = false) {
        // if the temp local is not the left op of ArkAssignStmt, it should get the actual text from tempCodeMap
        if (!isLeftOp && this.tempCodeMap.has(temp.getName()) && PrinterUtils_1.PrinterUtils.isTemp(temp.getName())) {
            this.tempVisitor.add(temp.getName());
            return this.tempCodeMap.get(temp.getName());
        }
        return temp.getName();
    }
    getTempCodeMap() {
        return this.tempCodeMap;
    }
    hasTempVisit(temp) {
        return this.tempVisitor.has(temp);
    }
    setTempVisit(temp) {
        this.tempVisitor.add(temp);
    }
    getPrinter() {
        return this.printer;
    }
    dump() {
        this.printStmts();
        return this.printer.toString();
    }
    buildSourceStmt() {
        this.cfgUtils.preOrder(this.cfgUtils.getEntry(), (block, type) => {
            this.buildBasicBlock(block, type);
        });
    }
    buildBasicBlock(block, type) {
        if (type === CfgStructualAnalysis_1.CodeBlockType.BREAK) {
            this.pushStmt(new SourceStmt_1.SourceBreakStmt(this, this.lastStmt));
            return;
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.CONTINUE) {
            this.pushStmt(new SourceStmt_1.SourceContinueStmt(this, this.lastStmt));
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.COMPOUND_END) {
            this.pushStmt(new SourceStmt_1.SourceCompoundEndStmt(this, this.lastStmt, '}'));
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.ELSE) {
            this.pushStmt(new SourceStmt_1.SourceElseStmt(this, this.lastStmt));
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.DO) {
            this.pushStmt(new SourceStmt_1.SourceDoStmt(this, this.lastStmt));
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.TRY) {
            this.pushStmt(new SourceStmt_1.SourceTryStmt(this, this.lastStmt));
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.CATCH) {
            this.pushStmt(new SourceStmt_1.SourceCatchStmt(this, this.lastStmt, block));
            // catch need read block first stmt, using return to void walk block twice.
            return;
        }
        else if (type === CfgStructualAnalysis_1.CodeBlockType.FINALLY) {
            this.pushStmt(new SourceStmt_1.SourceFinallyStmt(this, this.lastStmt));
        }
        if (!block) {
            return;
        }
        let originalStmts = this.sortStmt(block.getStmts());
        this.stmtReader = new StmtReader(originalStmts);
        while (this.stmtReader.hasNext()) {
            let stmt = this.stmtReader.next();
            if (this.skipStmts.has(stmt)) {
                continue;
            }
            if (stmt instanceof Stmt_1.ArkIfStmt) {
                if (type === CfgStructualAnalysis_1.CodeBlockType.IF) {
                    this.pushStmt(new SourceStmt_1.SourceIfStmt(this, stmt));
                }
                else if (type === CfgStructualAnalysis_1.CodeBlockType.WHILE) {
                    this.pushStmt(new SourceStmt_1.SourceWhileStmt(this, stmt, block));
                }
                else if (type === CfgStructualAnalysis_1.CodeBlockType.FOR) {
                    let inc = this.cfgUtils.getForIncBlock(block);
                    this.pushStmt(new SourceStmt_1.SourceForStmt(this, stmt, block, inc));
                }
                else if (type === CfgStructualAnalysis_1.CodeBlockType.DO_WHILE) {
                    this.pushStmt(new SourceStmt_1.SourceDoWhileStmt(this, stmt, block));
                }
            }
            else {
                this.pushStmt((0, SourceStmt_1.stmt2SourceStmt)(this, stmt));
            }
            this.lastStmt = stmt;
        }
    }
    printStmts() {
        for (let stmt of this.stmts) {
            if (this.skipStmts.has(stmt.original)) {
                continue;
            }
            this.printer.write(stmt.dump());
        }
    }
    getStmts() {
        return this.stmts.filter(value => !this.skipStmts.has(value.original));
    }
    pushStmt(stmt) {
        let lastLine = this.getLastLine();
        if (stmt.getLine() < lastLine) {
            stmt.setLine(lastLine + 0.1);
        }
        stmt.transfer2ts();
        this.stmts.push(stmt);
    }
    getLastLine() {
        if (this.stmts.length > 0) {
            return this.stmts[this.stmts.length - 1].getLine();
        }
        return 0;
    }
    /*
     * temp9 = new <>.<>();                            temp10 = new Array<number>(3);
     * temp10 = new Array<number>(3);                  temp10[0] = 'Cat';
     * temp10[0] = 'Cat';                        ==>   temp10[1] = 'Dog';
     * temp10[1] = 'Dog';                              temp10[2] = 'Hamster';
     * temp10[2] = 'Hamster';                          temp9 = new <>.<>();
     * temp9.constructor(temp10);                      temp9.constructor(temp10);
     */
    sortStmt(stmts) {
        for (let i = stmts.length - 1; i > 0; i--) {
            if (stmts[i] instanceof Stmt_1.ArkInvokeStmt && stmts[i].getInvokeExpr()) {
                let instanceInvokeExpr = stmts[i].getInvokeExpr();
                if ('constructor' !== instanceInvokeExpr.getMethodSignature().getMethodSubSignature().getMethodName()) {
                    continue;
                }
                let localName = instanceInvokeExpr.getBase().getName();
                let newExprIdx = findNewExpr(i, localName);
                if (newExprIdx >= 0 && newExprIdx < i - 1) {
                    moveStmt(i, newExprIdx);
                }
            }
        }
        return stmts;
        function findNewExpr(constructorIdx, name) {
            for (let j = constructorIdx - 1; j >= 0; j--) {
                if (!(stmts[j] instanceof Stmt_1.ArkAssignStmt)) {
                    continue;
                }
                const leftOp = stmts[j].getLeftOp();
                if (leftOp instanceof Local_1.Local && leftOp.getName() === name) {
                    return j;
                }
            }
            return -1;
        }
        function moveStmt(constructorIdx, newExprIdx) {
            let back = stmts[newExprIdx];
            for (let i = newExprIdx; i < constructorIdx - 1; i++) {
                stmts[i] = stmts[i + 1];
            }
            stmts[constructorIdx - 1] = back;
        }
    }
}
exports.SourceBody = SourceBody;
class StmtReader {
    constructor(stmts) {
        this.stmts = [];
        this.stmts = stmts;
        this.pos = 0;
    }
    first() {
        return this.stmts[0];
    }
    hasNext() {
        return this.pos < this.stmts.length;
    }
    next() {
        if (!this.hasNext()) {
            logger.error('SourceBody: StmtReader->next No more stmt.');
            throw new Error('No more stmt.');
        }
        let stmt = this.stmts[this.pos];
        this.pos++;
        return stmt;
    }
    rollback() {
        if (this.pos === 0) {
            logger.error('SourceBody: StmtReader->rollback No more stmt to rollback.');
            throw new Error('No more stmt to rollback.');
        }
        this.pos--;
    }
}
exports.StmtReader = StmtReader;
