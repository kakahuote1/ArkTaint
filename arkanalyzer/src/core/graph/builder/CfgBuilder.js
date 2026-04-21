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
exports.CfgBuilder = exports.BlockBuilder = exports.TryStatementBuilder = exports.SwitchStatementBuilder = void 0;
const ts = __importStar(require("ohos-typescript"));
const Stmt_1 = require("../../base/Stmt");
const BasicBlock_1 = require("../BasicBlock");
const Cfg_1 = require("../Cfg");
const ArkClass_1 = require("../../model/ArkClass");
const ArkIRTransformer_1 = require("../../common/ArkIRTransformer");
const ModelUtils_1 = require("../../common/ModelUtils");
const IRUtils_1 = require("../../common/IRUtils");
const Type_1 = require("../../base/Type");
const LoopBuilder_1 = require("./LoopBuilder");
const SwitchBuilder_1 = require("./SwitchBuilder");
const ConditionBuilder_1 = require("./ConditionBuilder");
const TrapBuilder_1 = require("./TrapBuilder");
const TSConst_1 = require("../../common/TSConst");
const ArkBaseModel_1 = require("../../model/ArkBaseModel");
const logger_1 = __importStar(require("../../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'CfgBuilder');
class StatementBuilder {
    constructor(type, code, astNode, scopeID) {
        this.addressCode3 = [];
        this.passTmies = 0;
        this.numOfIdentifier = 0;
        this.isDoWhile = false;
        this.type = type;
        this.code = code;
        this.next = null;
        this.lasts = new Set();
        this.walked = false;
        this.index = 0;
        this.line = -1;
        this.column = -1;
        this.astNode = astNode;
        this.scopeID = scopeID;
        this.block = null;
        this.ifExitPass = false;
    }
}
class ConditionStatementBuilder extends StatementBuilder {
    constructor(type, code, astNode, scopeID) {
        super(type, code, astNode, scopeID);
        this.doStatement = null;
        this.nextT = null;
        this.nextF = null;
        this.loopBlock = null;
        this.condition = '';
    }
}
class SwitchStatementBuilder extends StatementBuilder {
    constructor(type, code, astNode, scopeID) {
        super(type, code, astNode, scopeID);
        this.cases = [];
        this.default = null;
        this.afterSwitch = null;
        this.nexts = [];
    }
}
exports.SwitchStatementBuilder = SwitchStatementBuilder;
class TryStatementBuilder extends StatementBuilder {
    constructor(type, code, astNode, scopeID) {
        super(type, code, astNode, scopeID);
        this.tryFirst = null;
        this.tryExit = null;
        this.catchStatement = null;
        this.catchError = '';
        this.finallyStatement = null;
        this.afterFinal = null;
    }
}
exports.TryStatementBuilder = TryStatementBuilder;
class Case {
    constructor(value, stmt) {
        this.value = value;
        this.stmt = stmt;
    }
}
class DefUseChain {
    constructor(def, use) {
        this.def = def;
        this.use = use;
    }
}
class Variable {
    constructor(name, lastDef) {
        this.properties = [];
        this.propOf = null;
        this.name = name;
        this.lastDef = lastDef;
        this.defUse = [];
    }
}
class Scope {
    constructor(id) {
        this.id = id;
    }
}
class BlockBuilder {
    constructor(id, stmts) {
        this.nexts = [];
        this.lasts = [];
        this.walked = false;
        this.id = id;
        this.stmts = stmts;
    }
    removePredecessorBlock(block) {
        let index = this.lasts.indexOf(block);
        if (index < 0) {
            return false;
        }
        this.lasts.splice(index, 1);
        return true;
    }
    removeSuccessorBlock(block) {
        let index = this.nexts.indexOf(block);
        if (index < 0) {
            return false;
        }
        this.nexts.splice(index, 1);
        return true;
    }
}
exports.BlockBuilder = BlockBuilder;
class Catch {
    constructor(errorName, from, to, withLabel) {
        this.errorName = errorName;
        this.from = from;
        this.to = to;
        this.withLabel = withLabel;
    }
}
class TextError extends Error {
    constructor(message) {
        // 调用父类的构造函数，并传入错误消息
        super(message);
        // 设置错误类型的名称
        this.name = 'TextError';
    }
}
class CfgBuilder {
    constructor(ast, name, declaringMethod, sourceFile) {
        this.exits = [];
        this.emptyBody = false;
        this.arrowFunctionWithoutBlock = false;
        this.name = name;
        this.astRoot = ast;
        this.declaringMethod = declaringMethod;
        this.declaringClass = declaringMethod.getDeclaringArkClass();
        this.entry = new StatementBuilder('entry', '', ast, 0);
        this.loopStack = [];
        this.switchExitStack = [];
        this.functions = [];
        this.breakin = '';
        this.statementArray = [];
        this.dotEdges = [];
        this.exit = new StatementBuilder('exit', 'return;', null, 0);
        this.scopes = [];
        this.tempVariableNum = 0;
        this.current3ACstm = this.entry;
        this.blocks = [];
        this.currentDeclarationKeyword = '';
        this.variables = [];
        this.importFromPath = [];
        this.catches = [];
        this.sourceFile = sourceFile;
        this.arrowFunctionWithoutBlock = true;
    }
    getDeclaringMethod() {
        return this.declaringMethod;
    }
    judgeLastType(s, lastStatement) {
        if (lastStatement.type === 'ifStatement') {
            let lastIf = lastStatement;
            if (lastIf.nextT == null) {
                lastIf.nextT = s;
                s.lasts.add(lastIf);
            }
            else {
                lastIf.nextF = s;
                s.lasts.add(lastIf);
            }
        }
        else if (lastStatement.type === 'loopStatement') {
            let lastLoop = lastStatement;
            lastLoop.nextT = s;
            s.lasts.add(lastLoop);
        }
        else if (lastStatement.type === 'catchOrNot') {
            let lastLoop = lastStatement;
            lastLoop.nextT = s;
            s.lasts.add(lastLoop);
        }
        else {
            lastStatement.next = s;
            s.lasts.add(lastStatement);
        }
    }
    ASTNodeBreakStatement(c, lastStatement) {
        let p = c;
        while (p && p !== this.astRoot) {
            if (ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p)) {
                const lastLoopNextF = this.loopStack[this.loopStack.length - 1].nextF;
                this.judgeLastType(lastLoopNextF, lastStatement);
                lastLoopNextF.lasts.add(lastStatement);
                return;
            }
            if (ts.isCaseClause(p) || ts.isDefaultClause(p)) {
                const lastSwitchExit = this.switchExitStack[this.switchExitStack.length - 1];
                this.judgeLastType(lastSwitchExit, lastStatement);
                lastSwitchExit.lasts.add(lastStatement);
                return;
            }
            p = p.parent;
        }
    }
    ASTNodeIfStatement(c, lastStatement, scopeID) {
        let ifstm = new ConditionStatementBuilder('ifStatement', '', c, scopeID);
        this.judgeLastType(ifstm, lastStatement);
        let ifexit = new StatementBuilder('ifExit', '', c, scopeID);
        this.exits.push(ifexit);
        ifstm.condition = c.expression.getText(this.sourceFile);
        ifstm.code = 'if (' + ifstm.condition + ')';
        if (ts.isBlock(c.thenStatement)) {
            this.walkAST(ifstm, ifexit, [...c.thenStatement.statements]);
        }
        else {
            this.walkAST(ifstm, ifexit, [c.thenStatement]);
        }
        if (c.elseStatement) {
            if (ts.isBlock(c.elseStatement)) {
                this.walkAST(ifstm, ifexit, [...c.elseStatement.statements]);
            }
            else {
                this.walkAST(ifstm, ifexit, [c.elseStatement]);
            }
        }
        if (!ifstm.nextT) {
            ifstm.nextT = ifexit;
            ifexit.lasts.add(ifstm);
        }
        if (!ifstm.nextF) {
            ifstm.nextF = ifexit;
            ifexit.lasts.add(ifstm);
        }
        return ifexit;
    }
    ASTNodeWhileStatement(c, lastStatement, scopeID) {
        this.breakin = 'loop';
        let loopstm = new ConditionStatementBuilder('loopStatement', '', c, scopeID);
        this.loopStack.push(loopstm);
        this.judgeLastType(loopstm, lastStatement);
        let loopExit = new StatementBuilder('loopExit', '', c, scopeID);
        this.exits.push(loopExit);
        loopstm.nextF = loopExit;
        loopExit.lasts.add(loopstm);
        loopstm.condition = c.expression.getText(this.sourceFile);
        loopstm.code = 'while (' + loopstm.condition + ')';
        if (ts.isBlock(c.statement)) {
            this.walkAST(loopstm, loopstm, [...c.statement.statements]);
        }
        else {
            this.walkAST(loopstm, loopstm, [c.statement]);
        }
        if (!loopstm.nextF) {
            loopstm.nextF = loopExit;
            loopExit.lasts.add(loopstm);
        }
        if (!loopstm.nextT) {
            loopstm.nextT = loopExit;
            loopExit.lasts.add(loopstm);
        }
        this.loopStack.pop();
        return loopExit;
    }
    ASTNodeForStatement(c, lastStatement, scopeID) {
        this.breakin = 'loop';
        let loopstm = new ConditionStatementBuilder('loopStatement', '', c, scopeID);
        this.loopStack.push(loopstm);
        this.judgeLastType(loopstm, lastStatement);
        let loopExit = new StatementBuilder('loopExit', '', c, scopeID);
        this.exits.push(loopExit);
        loopstm.nextF = loopExit;
        loopExit.lasts.add(loopstm);
        loopstm.code = 'for (';
        if (ts.isForStatement(c)) {
            loopstm.code +=
                c.initializer?.getText(this.sourceFile) + '; ' + c.condition?.getText(this.sourceFile) + '; ' + c.incrementor?.getText(this.sourceFile);
        }
        else if (ts.isForOfStatement(c)) {
            loopstm.code += c.initializer?.getText(this.sourceFile) + ' of ' + c.expression.getText(this.sourceFile);
        }
        else {
            loopstm.code += c.initializer?.getText(this.sourceFile) + ' in ' + c.expression.getText(this.sourceFile);
        }
        loopstm.code += ')';
        if (ts.isBlock(c.statement)) {
            this.walkAST(loopstm, loopstm, [...c.statement.statements]);
        }
        else {
            this.walkAST(loopstm, loopstm, [c.statement]);
        }
        if (!loopstm.nextF) {
            loopstm.nextF = loopExit;
            loopExit.lasts.add(loopstm);
        }
        if (!loopstm.nextT) {
            loopstm.nextT = loopExit;
            loopExit.lasts.add(loopstm);
        }
        this.loopStack.pop();
        return loopExit;
    }
    ASTNodeDoStatement(c, lastStatement, scopeID) {
        this.breakin = 'loop';
        let loopstm = new ConditionStatementBuilder('loopStatement', '', c, scopeID);
        this.loopStack.push(loopstm);
        let loopExit = new StatementBuilder('loopExit', '', c, scopeID);
        this.exits.push(loopExit);
        loopstm.nextF = loopExit;
        loopExit.lasts.add(loopstm);
        loopstm.condition = c.expression.getText(this.sourceFile);
        loopstm.code = 'while (' + loopstm.condition + ')';
        loopstm.isDoWhile = true;
        if (ts.isBlock(c.statement)) {
            this.walkAST(lastStatement, loopstm, [...c.statement.statements]);
        }
        else {
            this.walkAST(lastStatement, loopstm, [c.statement]);
        }
        let lastType = lastStatement.type;
        if (lastType === 'ifStatement' || lastType === 'loopStatement') {
            let lastCondition = lastStatement;
            loopstm.nextT = lastCondition.nextT;
            lastCondition.nextT?.lasts.add(loopstm);
        }
        else {
            loopstm.nextT = lastStatement.next;
            lastStatement.next?.lasts.add(loopstm);
        }
        if (loopstm.nextT && loopstm.nextT !== loopstm) {
            loopstm.nextT.isDoWhile = true;
            loopstm.doStatement = loopstm.nextT;
        }
        this.loopStack.pop();
        return loopExit;
    }
    ASTNodeSwitchStatement(c, lastStatement, scopeID) {
        this.breakin = 'switch';
        let switchstm = new SwitchStatementBuilder('switchStatement', '', c, scopeID);
        this.judgeLastType(switchstm, lastStatement);
        let switchExit = new StatementBuilder('switchExit', '', null, scopeID);
        this.exits.push(switchExit);
        this.switchExitStack.push(switchExit);
        switchExit.lasts.add(switchstm);
        switchstm.code = 'switch (' + c.expression + ')';
        let lastCaseExit = null;
        for (let i = 0; i < c.caseBlock.clauses.length; i++) {
            const clause = c.caseBlock.clauses[i];
            let casestm;
            if (ts.isCaseClause(clause)) {
                casestm = new StatementBuilder('statement', 'case ' + clause.expression.getText(this.sourceFile) + ':', clause, scopeID);
            }
            else {
                casestm = new StatementBuilder('statement', 'default:', clause, scopeID);
            }
            switchstm.nexts.push(casestm);
            casestm.lasts.add(switchstm);
            let caseExit = new StatementBuilder('caseExit', '', null, scopeID);
            this.exits.push(caseExit);
            this.walkAST(casestm, caseExit, [...clause.statements]);
            if (ts.isCaseClause(clause)) {
                const cas = new Case(casestm.code, casestm.next);
                switchstm.cases.push(cas);
            }
            else {
                switchstm.default = casestm.next;
            }
            switchstm.nexts[switchstm.nexts.length - 1] = casestm.next;
            for (const stmt of [...casestm.lasts]) {
                casestm.next.lasts.add(stmt);
            }
            casestm.next.lasts.delete(casestm);
            if (lastCaseExit) {
                lastCaseExit.next = casestm.next;
                casestm.next?.lasts.add(lastCaseExit);
            }
            lastCaseExit = caseExit;
            if (i === c.caseBlock.clauses.length - 1) {
                caseExit.next = switchExit;
                switchExit.lasts.add(caseExit);
            }
        }
        this.switchExitStack.pop();
        return switchExit;
    }
    ASTNodeTryStatement(c, lastStatement, scopeID) {
        let trystm = new TryStatementBuilder('tryStatement', 'try', c, scopeID);
        this.judgeLastType(trystm, lastStatement);
        let tryExit = new StatementBuilder('tryExit', '', c, scopeID);
        this.exits.push(tryExit);
        trystm.tryExit = tryExit;
        this.walkAST(trystm, tryExit, [...c.tryBlock.statements]);
        trystm.tryFirst = trystm.next;
        trystm.next?.lasts.add(trystm);
        if (c.catchClause) {
            let text = 'catch';
            if (c.catchClause.variableDeclaration) {
                text += '(' + c.catchClause.variableDeclaration.getText(this.sourceFile) + ')';
            }
            let catchOrNot = new ConditionStatementBuilder('catchOrNot', text, c, scopeID);
            let catchExit = new StatementBuilder('catch exit', '', c, scopeID);
            catchOrNot.nextF = catchExit;
            catchExit.lasts.add(catchOrNot);
            this.walkAST(catchOrNot, catchExit, [...c.catchClause.block.statements]);
            if (!catchOrNot.nextT) {
                catchOrNot.nextT = catchExit;
                catchExit.lasts.add(catchOrNot);
            }
            const catchStatement = new StatementBuilder('statement', catchOrNot.code, c.catchClause, catchOrNot.nextT.scopeID);
            catchStatement.next = catchOrNot.nextT;
            trystm.catchStatement = catchStatement;
            catchStatement.lasts.add(trystm);
            if (c.catchClause.variableDeclaration) {
                trystm.catchError = c.catchClause.variableDeclaration.getText(this.sourceFile);
            }
            else {
                trystm.catchError = 'Error';
            }
        }
        let final = new StatementBuilder('statement', 'finally', c, scopeID);
        let finalExit = new StatementBuilder('finallyExit', '', c, scopeID);
        this.exits.push(finalExit);
        if (c.finallyBlock && c.finallyBlock.statements.length > 0) {
            this.walkAST(final, finalExit, [...c.finallyBlock.statements]);
        }
        else {
            let dummyFinally = new StatementBuilder('statement', 'dummyFinally', c, new Scope(this.scopes.length).id);
            final.next = dummyFinally;
            dummyFinally.lasts.add(final);
            dummyFinally.next = finalExit;
            finalExit.lasts.add(dummyFinally);
        }
        trystm.finallyStatement = final.next;
        tryExit.next = final.next;
        final.next?.lasts.add(tryExit);
        trystm.next = finalExit;
        finalExit.lasts.add(trystm);
        return finalExit;
    }
    walkAST(lastStatement, nextStatement, nodes) {
        let scope = new Scope(this.scopes.length);
        this.scopes.push(scope);
        for (let i = 0; i < nodes.length; i++) {
            let c = nodes[i];
            if (ts.isVariableStatement(c) || ts.isExpressionStatement(c) || ts.isThrowStatement(c) || ts.isTypeAliasDeclaration(c) || ts.isParameter(c)) {
                let s = new StatementBuilder('statement', c.getText(this.sourceFile), c, scope.id);
                this.judgeLastType(s, lastStatement);
                lastStatement = s;
            }
            else if (!this.declaringMethod.isDefaultArkMethod() && ts.isFunctionDeclaration(c)) {
                let s = new StatementBuilder('functionDeclarationStatement', c.getText(this.sourceFile), c, scope.id);
                this.judgeLastType(s, lastStatement);
                lastStatement = s;
            }
            else if (!this.declaringMethod.isDefaultArkMethod() && ts.isClassDeclaration(c)) {
                let s = new StatementBuilder('classDeclarationStatement', c.getText(this.sourceFile), c, scope.id);
                this.judgeLastType(s, lastStatement);
                lastStatement = s;
            }
            else if (ts.isReturnStatement(c)) {
                let s = new StatementBuilder('returnStatement', c.getText(this.sourceFile), c, scope.id);
                this.judgeLastType(s, lastStatement);
                lastStatement = s;
                break;
            }
            else if (ts.isBreakStatement(c)) {
                this.ASTNodeBreakStatement(c, lastStatement);
                return;
            }
            else if (ts.isContinueStatement(c)) {
                const lastLoop = this.loopStack[this.loopStack.length - 1];
                this.judgeLastType(lastLoop, lastStatement);
                lastLoop.lasts.add(lastStatement);
                return;
            }
            else if (ts.isIfStatement(c)) {
                lastStatement = this.ASTNodeIfStatement(c, lastStatement, scope.id);
            }
            else if (ts.isWhileStatement(c)) {
                lastStatement = this.ASTNodeWhileStatement(c, lastStatement, scope.id);
            }
            if (ts.isForStatement(c) || ts.isForInStatement(c) || ts.isForOfStatement(c)) {
                lastStatement = this.ASTNodeForStatement(c, lastStatement, scope.id);
            }
            else if (ts.isDoStatement(c)) {
                lastStatement = this.ASTNodeDoStatement(c, lastStatement, scope.id);
            }
            else if (ts.isSwitchStatement(c)) {
                lastStatement = this.ASTNodeSwitchStatement(c, lastStatement, scope.id);
            }
            else if (ts.isBlock(c)) {
                let blockExit = new StatementBuilder('blockExit', '', c, scope.id);
                this.exits.push(blockExit);
                this.walkAST(lastStatement, blockExit, c.getChildren(this.sourceFile)[1].getChildren(this.sourceFile));
                lastStatement = blockExit;
            }
            else if (ts.isTryStatement(c)) {
                lastStatement = this.ASTNodeTryStatement(c, lastStatement, scope.id);
            }
            else if (ts.isExportAssignment(c)) {
                if (ts.isNewExpression(c.expression) || ts.isObjectLiteralExpression(c.expression)) {
                    let s = new StatementBuilder('statement', c.getText(this.sourceFile), c, scope.id);
                    this.judgeLastType(s, lastStatement);
                    lastStatement = s;
                }
            }
        }
        if (lastStatement.type !== 'breakStatement' && lastStatement.type !== 'continueStatement' && lastStatement.type !== 'returnStatement') {
            lastStatement.next = nextStatement;
            nextStatement.lasts.add(lastStatement);
        }
    }
    addReturnInEmptyMethod() {
        if (this.entry.next === this.exit) {
            const ret = new StatementBuilder('returnStatement', 'return;', null, this.entry.scopeID);
            this.entry.next = ret;
            ret.lasts.add(this.entry);
            ret.next = this.exit;
            this.exit.lasts = new Set([ret]);
        }
    }
    deleteExitAfterCondition(last, exit) {
        if (last.nextT === exit) {
            last.nextT = exit.next;
            const lasts = exit.next.lasts;
            lasts.delete(exit);
            lasts.add(last);
        }
        else if (last.nextF === exit) {
            last.nextF = exit.next;
            const lasts = exit.next.lasts;
            lasts.delete(exit);
            lasts.add(last);
        }
    }
    deleteExitAfterSwitch(last, exit) {
        if (exit.type === 'switchExit') {
            last.afterSwitch = exit.next;
        }
        exit.next.lasts.delete(exit);
        last.nexts = last.nexts.filter(item => item !== exit);
        if (last.nexts.length === 0) {
            last.next = exit.next;
            exit.next?.lasts.add(last);
        }
    }
    deleteExit() {
        for (const exit of this.exits) {
            const lasts = [...exit.lasts];
            for (const last of lasts) {
                if (last instanceof ConditionStatementBuilder) {
                    this.deleteExitAfterCondition(last, exit);
                }
                else if (last instanceof SwitchStatementBuilder) {
                    this.deleteExitAfterSwitch(last, exit);
                }
                else if (last instanceof TryStatementBuilder && exit.type === 'finallyExit') {
                    last.afterFinal = exit.next;
                    last.next = last.tryFirst;
                    exit.lasts.delete(last);
                }
                else {
                    last.next = exit.next;
                    const lasts = exit.next.lasts;
                    lasts.delete(exit);
                    lasts.add(last);
                }
            }
        }
        // 部分语句例如return后面的exit语句的next无法在上面清除
        for (const exit of this.exits) {
            if (exit.next && exit.next.lasts.has(exit)) {
                exit.next.lasts.delete(exit);
            }
        }
    }
    addStmt2BlockStmtQueueInSpecialCase(stmt, stmtQueue) {
        if (stmt.next) {
            if (((stmt.type === 'continueStatement' || stmt.next.type === 'loopStatement') && stmt.next.block) || stmt.next.type.includes('exit')) {
                return null;
            }
            stmt.next.passTmies++;
            if (stmt.next.passTmies === stmt.next.lasts.size || stmt.next.type === 'loopStatement' || stmt.next.isDoWhile) {
                if (stmt.next.scopeID !== stmt.scopeID &&
                    !(stmt.next instanceof ConditionStatementBuilder && stmt.next.doStatement) &&
                    !(ts.isCaseClause(stmt.astNode) || ts.isDefaultClause(stmt.astNode))) {
                    stmtQueue.push(stmt.next);
                    return null;
                }
                return stmt.next;
            }
        }
        return null;
    }
    addStmt2BlockStmtQueue(stmt, stmtQueue) {
        if (stmt instanceof ConditionStatementBuilder) {
            stmtQueue.push(stmt.nextF);
            stmtQueue.push(stmt.nextT);
        }
        else if (stmt instanceof SwitchStatementBuilder) {
            if (stmt.nexts.length === 0) {
                stmtQueue.push(stmt.afterSwitch);
            }
            for (let i = stmt.nexts.length - 1; i >= 0; i--) {
                stmtQueue.push(stmt.nexts[i]);
            }
            if (stmt.afterSwitch && stmt.afterSwitch.lasts.size === 0) {
                stmtQueue.push(stmt.afterSwitch);
            }
        }
        else if (stmt instanceof TryStatementBuilder) {
            if (stmt.finallyStatement) {
                stmtQueue.push(stmt.finallyStatement);
            }
            if (stmt.catchStatement) {
                stmtQueue.push(stmt.catchStatement);
            }
            if (stmt.tryFirst) {
                stmtQueue.push(stmt.tryFirst);
            }
        }
        else if (stmt.next) {
            return this.addStmt2BlockStmtQueueInSpecialCase(stmt, stmtQueue);
        }
        return null;
    }
    buildBlocks() {
        const stmtQueue = [this.entry];
        const handledStmts = new Set();
        while (stmtQueue.length > 0) {
            let stmt = stmtQueue.pop();
            if (stmt.type.includes('exit')) {
                continue;
            }
            if (handledStmts.has(stmt)) {
                continue;
            }
            const block = new BlockBuilder(this.blocks.length, []);
            this.blocks.push(block);
            while (stmt && !handledStmts.has(stmt)) {
                if (stmt.type === 'loopStatement' && block.stmts.length > 0 && !stmt.isDoWhile) {
                    stmtQueue.push(stmt);
                    break;
                }
                if (stmt.type.includes('Exit')) {
                    break;
                }
                block.stmts.push(stmt);
                stmt.block = block;
                handledStmts.add(stmt);
                const addRet = this.addStmt2BlockStmtQueue(stmt, stmtQueue);
                if (addRet instanceof StatementBuilder) {
                    stmt = addRet;
                }
                else {
                    break;
                }
            }
        }
    }
    buildConditionNextBlocks(originStatement, block, isLastStatement) {
        let nextT = originStatement.nextT?.block;
        if (nextT && (isLastStatement || nextT !== block) && !originStatement.nextT?.type.includes(' exit')) {
            block.nexts.push(nextT);
            nextT.lasts.push(block);
        }
        let nextF = originStatement.nextF?.block;
        if (nextF && (isLastStatement || nextF !== block) && !originStatement.nextF?.type.includes(' exit')) {
            block.nexts.push(nextF);
            nextF.lasts.push(block);
        }
    }
    buildSwitchNextBlocks(originStatement, block, isLastStatement) {
        if (originStatement.nexts.length === 0) {
            const nextBlock = originStatement.afterSwitch.block;
            if (nextBlock && (isLastStatement || nextBlock !== block)) {
                block.nexts.push(nextBlock);
                nextBlock.lasts.push(block);
            }
        }
        for (const next of originStatement.nexts) {
            const nextBlock = next.block;
            if (nextBlock && (isLastStatement || nextBlock !== block)) {
                block.nexts.push(nextBlock);
                nextBlock.lasts.push(block);
            }
        }
    }
    buildNormalNextBlocks(originStatement, block, isLastStatement) {
        let next = originStatement.next?.block;
        if (next && (isLastStatement || next !== block) && !originStatement.next?.type.includes(' exit')) {
            block.nexts.push(next);
            next.lasts.push(block);
        }
    }
    buildBlocksNextLast() {
        for (let block of this.blocks) {
            for (let originStatement of block.stmts) {
                let isLastStatement = block.stmts.indexOf(originStatement) === block.stmts.length - 1;
                if (originStatement instanceof ConditionStatementBuilder) {
                    this.buildConditionNextBlocks(originStatement, block, isLastStatement);
                }
                else if (originStatement instanceof SwitchStatementBuilder) {
                    this.buildSwitchNextBlocks(originStatement, block, isLastStatement);
                }
                else {
                    this.buildNormalNextBlocks(originStatement, block, isLastStatement);
                }
            }
        }
    }
    addReturnBlock(returnStatement, notReturnStmts) {
        let returnBlock = new BlockBuilder(this.blocks.length, [returnStatement]);
        returnStatement.block = returnBlock;
        this.blocks.push(returnBlock);
        for (const notReturnStmt of notReturnStmts) {
            if (notReturnStmt instanceof ConditionStatementBuilder) {
                if (this.exit === notReturnStmt.nextT) {
                    notReturnStmt.nextT = returnStatement;
                    notReturnStmt.block?.nexts.splice(0, 0, returnBlock);
                }
                else if (this.exit === notReturnStmt.nextF) {
                    notReturnStmt.nextF = returnStatement;
                    notReturnStmt.block?.nexts.push(returnBlock);
                }
            }
            else {
                notReturnStmt.next = returnStatement;
                notReturnStmt.block?.nexts.push(returnBlock);
            }
            returnStatement.lasts.add(notReturnStmt);
            returnStatement.next = this.exit;
            const lasts = [...this.exit.lasts];
            lasts[lasts.indexOf(notReturnStmt)] = returnStatement;
            this.exit.lasts = new Set(lasts);
            returnBlock.lasts.push(notReturnStmt.block);
        }
        this.exit.block = returnBlock;
    }
    addReturnStmt() {
        let notReturnStmts = [];
        for (let stmt of [...this.exit.lasts]) {
            if (stmt.type !== 'returnStatement') {
                notReturnStmts.push(stmt);
            }
        }
        if (notReturnStmts.length < 1) {
            return;
        }
        const returnStatement = new StatementBuilder('returnStatement', 'return;', null, this.exit.scopeID);
        let TryOrSwitchExit = false;
        if (notReturnStmts.length === 1 && notReturnStmts[0].block) {
            let p = notReturnStmts[0].astNode;
            while (p && p !== this.astRoot) {
                if (ts.isTryStatement(p) || ts.isSwitchStatement(p)) {
                    TryOrSwitchExit = true;
                    break;
                }
                p = p.parent;
            }
        }
        if (notReturnStmts.length === 1 && !(notReturnStmts[0] instanceof ConditionStatementBuilder) && !TryOrSwitchExit) {
            const notReturnStmt = notReturnStmts[0];
            notReturnStmt.next = returnStatement;
            returnStatement.lasts = new Set([notReturnStmt]);
            returnStatement.next = this.exit;
            const lasts = [...this.exit.lasts];
            lasts[lasts.indexOf(notReturnStmt)] = returnStatement;
            this.exit.lasts = new Set(lasts);
            notReturnStmt.block?.stmts.push(returnStatement);
            returnStatement.block = notReturnStmt.block;
        }
        else {
            this.addReturnBlock(returnStatement, notReturnStmts);
        }
    }
    resetWalked() {
        for (let stmt of this.statementArray) {
            stmt.walked = false;
        }
    }
    addStmtBuilderPosition() {
        for (const stmt of this.statementArray) {
            if (stmt.astNode) {
                const { line, character } = ts.getLineAndCharacterOfPosition(this.sourceFile, stmt.astNode.getStart(this.sourceFile));
                stmt.line = line + 1;
                stmt.column = character + 1;
            }
        }
    }
    CfgBuilder2Array(stmt) {
        if (stmt.walked) {
            return;
        }
        stmt.walked = true;
        stmt.index = this.statementArray.length;
        if (!stmt.type.includes(' exit')) {
            this.statementArray.push(stmt);
        }
        if (stmt.type === 'ifStatement' || stmt.type === 'loopStatement' || stmt.type === 'catchOrNot') {
            let cstm = stmt;
            if (cstm.nextT == null || cstm.nextF == null) {
                this.errorTest(cstm);
                return;
            }
            this.CfgBuilder2Array(cstm.nextF);
            this.CfgBuilder2Array(cstm.nextT);
        }
        else if (stmt.type === 'switchStatement') {
            let sstm = stmt;
            for (let ss of sstm.nexts) {
                this.CfgBuilder2Array(ss);
            }
        }
        else if (stmt.type === 'tryStatement') {
            let trystm = stmt;
            if (trystm.tryFirst) {
                this.CfgBuilder2Array(trystm.tryFirst);
            }
            if (trystm.catchStatement) {
                this.CfgBuilder2Array(trystm.catchStatement);
            }
            if (trystm.finallyStatement) {
                this.CfgBuilder2Array(trystm.finallyStatement);
            }
            if (trystm.next) {
                this.CfgBuilder2Array(trystm.next);
            }
        }
        else {
            if (stmt.next != null) {
                this.CfgBuilder2Array(stmt.next);
            }
        }
    }
    getDotEdges(stmt) {
        if (this.statementArray.length === 0) {
            this.CfgBuilder2Array(this.entry);
        }
        if (stmt.walked) {
            return;
        }
        stmt.walked = true;
        if (stmt.type === 'ifStatement' || stmt.type === 'loopStatement' || stmt.type === 'catchOrNot') {
            let cstm = stmt;
            if (cstm.nextT == null || cstm.nextF == null) {
                this.errorTest(cstm);
                return;
            }
            let edge = [cstm.index, cstm.nextF.index];
            this.dotEdges.push(edge);
            edge = [cstm.index, cstm.nextT.index];
            this.dotEdges.push(edge);
            this.getDotEdges(cstm.nextF);
            this.getDotEdges(cstm.nextT);
        }
        else if (stmt.type === 'switchStatement') {
            let sstm = stmt;
            for (let ss of sstm.nexts) {
                let edge = [sstm.index, ss.index];
                this.dotEdges.push(edge);
                this.getDotEdges(ss);
            }
        }
        else {
            if (stmt.next != null) {
                let edge = [stmt.index, stmt.next.index];
                this.dotEdges.push(edge);
                this.getDotEdges(stmt.next);
            }
        }
    }
    errorTest(stmt) {
        let mes = 'ifnext error    ';
        if (this.declaringClass?.getDeclaringArkFile()) {
            mes += this.declaringClass?.getDeclaringArkFile().getName() + '.' + this.declaringClass.getName() + '.' + this.name;
        }
        mes += '\n' + stmt.code;
        throw new TextError(mes);
    }
    buildStatementBuilder4ArrowFunction(stmt) {
        let s = new StatementBuilder('statement', stmt.getText(this.sourceFile), stmt, 0);
        this.entry.next = s;
        s.lasts = new Set([this.entry]);
        s.next = this.exit;
        this.exit.lasts = new Set([s]);
    }
    getParamNodeWithInitializerOrModifier(paramNodes) {
        let stmts = [];
        paramNodes.forEach(param => {
            if (param.initializer !== undefined || param.modifiers !== undefined) {
                stmts.push(param);
            }
        });
        return stmts;
    }
    buildCfgBuilder() {
        let stmts = [];
        if (ts.isSourceFile(this.astRoot)) {
            stmts = [...this.astRoot.statements];
        }
        else if (ts.isFunctionDeclaration(this.astRoot) ||
            ts.isMethodDeclaration(this.astRoot) ||
            ts.isConstructorDeclaration(this.astRoot) ||
            ts.isGetAccessorDeclaration(this.astRoot) ||
            ts.isSetAccessorDeclaration(this.astRoot) ||
            ts.isFunctionExpression(this.astRoot) ||
            ts.isClassStaticBlockDeclaration(this.astRoot)) {
            this.astRoot.body ? stmts = [...this.astRoot.body.statements] : this.emptyBody = true;
        }
        else if (ts.isArrowFunction(this.astRoot)) {
            if (ts.isBlock(this.astRoot.body)) {
                stmts = [...this.astRoot.body.statements];
            }
        }
        else if (ts.isMethodSignature(this.astRoot) ||
            ts.isConstructSignatureDeclaration(this.astRoot) ||
            ts.isCallSignatureDeclaration(this.astRoot) ||
            ts.isFunctionTypeNode(this.astRoot)) {
            this.emptyBody = true;
        }
        else if (ts.isModuleDeclaration(this.astRoot) && ts.isModuleBlock(this.astRoot.body)) {
            stmts = [...this.astRoot.body.statements];
        }
        // Add param node with initializer or modifier to stmts which can be used when build body to create class field and initializer stmts.
        if (!this.emptyBody && ts.isFunctionLike(this.astRoot)) {
            stmts = [...this.getParamNodeWithInitializerOrModifier(this.astRoot.parameters), ...stmts];
        }
        if (!ModelUtils_1.ModelUtils.isArkUIBuilderMethod(this.declaringMethod)) {
            this.walkAST(this.entry, this.exit, stmts);
        }
        else {
            this.handleBuilder(stmts);
        }
        if (ts.isArrowFunction(this.astRoot) && !ts.isBlock(this.astRoot.body)) {
            this.buildStatementBuilder4ArrowFunction(this.astRoot.body);
        }
        this.addReturnInEmptyMethod();
        this.deleteExit();
        this.CfgBuilder2Array(this.entry);
        this.addStmtBuilderPosition();
        this.buildBlocks();
        this.blocks = this.blocks.filter(b => b.stmts.length !== 0);
        this.buildBlocksNextLast();
        this.addReturnStmt();
    }
    handleBuilder(stmts) {
        let lastStmt = this.entry;
        for (const stmt of stmts) {
            const stmtBuilder = new StatementBuilder('statement', stmt.getText(this.sourceFile), stmt, 0);
            lastStmt.next = stmtBuilder;
            stmtBuilder.lasts.add(lastStmt);
            lastStmt = stmtBuilder;
        }
        lastStmt.next = this.exit;
        this.exit.lasts.add(lastStmt);
    }
    isBodyEmpty() {
        return this.emptyBody;
    }
    buildCfg() {
        if (ts.isArrowFunction(this.astRoot) && !ts.isBlock(this.astRoot.body)) {
            return this.buildCfgForSimpleArrowFunction();
        }
        return this.buildNormalCfg();
    }
    buildCfgForSimpleArrowFunction() {
        const stmts = [];
        const arkIRTransformer = new ArkIRTransformer_1.ArkIRTransformer(this.sourceFile, this.declaringMethod);
        arkIRTransformer.prebuildStmts().forEach(stmt => stmts.push(stmt));
        const expressionBodyNode = this.astRoot.body;
        const expressionBodyStmts = [];
        let { value: expressionBodyValue, valueOriginalPositions: expressionBodyPositions, stmts: tempStmts, } = arkIRTransformer.tsNodeToValueAndStmts(expressionBodyNode);
        tempStmts.forEach(stmt => expressionBodyStmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(expressionBodyValue)) {
            ({
                value: expressionBodyValue,
                valueOriginalPositions: expressionBodyPositions,
                stmts: tempStmts,
            } = arkIRTransformer.generateAssignStmtForValue(expressionBodyValue, expressionBodyPositions));
            tempStmts.forEach(stmt => expressionBodyStmts.push(stmt));
        }
        const returnStmt = new Stmt_1.ArkReturnStmt(expressionBodyValue);
        returnStmt.setOperandOriginalPositions([expressionBodyPositions[0], ...expressionBodyPositions]);
        expressionBodyStmts.push(returnStmt);
        arkIRTransformer.mapStmtsToTsStmt(expressionBodyStmts, expressionBodyNode);
        expressionBodyStmts.forEach(stmt => stmts.push(stmt));
        const cfg = new Cfg_1.Cfg();
        const blockInCfg = new BasicBlock_1.BasicBlock();
        blockInCfg.setId(0);
        stmts.forEach(stmt => {
            blockInCfg.addStmt(stmt);
            stmt.setCfg(cfg);
        });
        cfg.addBlock(blockInCfg);
        cfg.setStartingStmt(stmts[0]);
        return {
            cfg: cfg,
            locals: arkIRTransformer.getLocals(),
            globals: arkIRTransformer.getGlobals(),
            aliasTypeMap: arkIRTransformer.getAliasTypeMap(),
            traps: [],
        };
    }
    buildNormalCfg() {
        const { blockBuilderToCfgBlock, basicBlockSet, arkIRTransformer } = this.initializeBuild();
        const { blocksContainLoopCondition, blockBuildersBeforeTry, blockBuildersContainSwitch, valueAndStmtsOfSwitchAndCasesAll } = this.processBlocks(blockBuilderToCfgBlock, basicBlockSet, arkIRTransformer);
        this.linkBasicBlocks(blockBuilderToCfgBlock);
        this.adjustBlocks(blockBuilderToCfgBlock, blocksContainLoopCondition, basicBlockSet, blockBuildersContainSwitch, valueAndStmtsOfSwitchAndCasesAll, arkIRTransformer);
        const trapBuilder = new TrapBuilder_1.TrapBuilder(blockBuildersBeforeTry, blockBuilderToCfgBlock, arkIRTransformer, basicBlockSet);
        const traps = trapBuilder.buildTraps();
        this.removeEmptyBlocks(basicBlockSet);
        const cfg = this.createCfg(blockBuilderToCfgBlock, basicBlockSet);
        return {
            cfg,
            locals: arkIRTransformer.getLocals(),
            globals: arkIRTransformer.getGlobals(),
            aliasTypeMap: arkIRTransformer.getAliasTypeMap(),
            traps,
        };
    }
    removeEmptyBlocks(basicBlockSet) {
        for (const bb of basicBlockSet) {
            if (bb.getStmts().length > 0) {
                continue;
            }
            const predecessors = bb.getPredecessors();
            const successors = bb.getSuccessors();
            // the empty basic block with neither predecessor nor successor could be deleted directly
            if (predecessors.length === 0 && successors.length === 0) {
                basicBlockSet.delete(bb);
                continue;
            }
            // the empty basic block with predecessor but no successor could be deleted directly and remove its ID from the predecessor blocks
            if (predecessors.length > 0 && successors.length === 0) {
                for (const predecessor of predecessors) {
                    predecessor.removeSuccessorBlock(bb);
                }
                basicBlockSet.delete(bb);
                continue;
            }
            // the empty basic block with successor but no predecessor could be deleted directly and remove its ID from the successor blocks
            if (predecessors.length === 0 && successors.length > 0) {
                for (const successor of successors) {
                    successor.removePredecessorBlock(bb);
                }
                basicBlockSet.delete(bb);
                continue;
            }
            // the rest case is the empty basic block both with predecessor and successor, should relink its predecessor and successor
            for (const predecessor of predecessors) {
                predecessor.removeSuccessorBlock(bb);
                successors.forEach(successor => predecessor.addSuccessorBlock(successor));
            }
            for (const successor of successors) {
                successor.removePredecessorBlock(bb);
                predecessors.forEach(predecessor => successor.addPredecessorBlock(predecessor));
            }
            basicBlockSet.delete(bb);
        }
    }
    initializeBuild() {
        const blockBuilderToCfgBlock = new Map();
        const basicBlockSet = new Set();
        const arkIRTransformer = new ArkIRTransformer_1.ArkIRTransformer(this.sourceFile, this.declaringMethod);
        return { blockBuilderToCfgBlock, basicBlockSet, arkIRTransformer };
    }
    processBlocks(blockBuilderToCfgBlock, basicBlockSet, arkIRTransformer) {
        const blocksContainLoopCondition = new Set();
        const blockBuildersBeforeTry = new Set();
        const blockBuildersContainSwitch = [];
        const valueAndStmtsOfSwitchAndCasesAll = [];
        for (let i = 0; i < this.blocks.length; i++) {
            const stmtsInBlock = [];
            if (i === 0) {
                arkIRTransformer.prebuildStmts().forEach(stmt => stmtsInBlock.push(stmt));
            }
            const stmtsCnt = this.blocks[i].stmts.length;
            if (this.blocks[i].stmts[stmtsCnt - 1].type === 'tryStatement') {
                blockBuildersBeforeTry.add(this.blocks[i]);
            }
            for (const statementBuilder of this.blocks[i].stmts) {
                if (statementBuilder.type === 'loopStatement') {
                    blocksContainLoopCondition.add(this.blocks[i]);
                }
                else if (statementBuilder instanceof SwitchStatementBuilder) {
                    blockBuildersContainSwitch.push(this.blocks[i]);
                    const valueAndStmtsOfSwitchAndCases = arkIRTransformer.switchStatementToValueAndStmts(statementBuilder.astNode);
                    valueAndStmtsOfSwitchAndCasesAll.push(valueAndStmtsOfSwitchAndCases);
                    continue;
                }
                if (statementBuilder.astNode && statementBuilder.code !== '') {
                    arkIRTransformer.tsNodeToStmts(statementBuilder.astNode).forEach(s => stmtsInBlock.push(s));
                }
                else if (statementBuilder.code.startsWith('return')) {
                    stmtsInBlock.push(this.generateReturnStmt(arkIRTransformer));
                }
            }
            const blockInCfg = new BasicBlock_1.BasicBlock();
            blockInCfg.setId(this.blocks[i].id);
            for (const stmt of stmtsInBlock) {
                blockInCfg.addStmt(stmt);
            }
            basicBlockSet.add(blockInCfg);
            blockBuilderToCfgBlock.set(this.blocks[i], blockInCfg);
        }
        return {
            blocksContainLoopCondition,
            blockBuildersBeforeTry,
            blockBuildersContainSwitch,
            valueAndStmtsOfSwitchAndCasesAll,
        };
    }
    generateReturnStmt(arkIRTransformer) {
        if (this.name === TSConst_1.CONSTRUCTOR_NAME) {
            this.declaringMethod.getSubSignature().setReturnType(arkIRTransformer.getThisLocal().getType());
            return new Stmt_1.ArkReturnStmt(arkIRTransformer.getThisLocal());
        }
        if (this.declaringMethod.getSubSignature().getReturnType() instanceof Type_1.UnknownType && !this.declaringMethod.getAsteriskToken()) {
            if (this.declaringMethod.containsModifier(ArkBaseModel_1.ModifierType.ASYNC)) {
                const promise = this.declaringMethod.getDeclaringArkFile().getScene().getSdkGlobal(TSConst_1.PROMISE);
                if (promise instanceof ArkClass_1.ArkClass) {
                    this.declaringMethod.getSubSignature().setReturnType(new Type_1.ClassType(promise.getSignature()));
                }
                else {
                    this.declaringMethod.getSubSignature().setReturnType(new Type_1.UnclearReferenceType(TSConst_1.PROMISE, [Type_1.VoidType.getInstance()]));
                }
            }
            else {
                this.declaringMethod.getSubSignature().setReturnType(Type_1.VoidType.getInstance());
            }
        }
        return new Stmt_1.ArkReturnVoidStmt();
    }
    adjustBlocks(blockBuilderToCfgBlock, blocksContainLoopCondition, basicBlockSet, blockBuildersContainSwitch, valueAndStmtsOfSwitchAndCasesAll, arkIRTransformer) {
        const loopBuilder = new LoopBuilder_1.LoopBuilder();
        loopBuilder.rebuildBlocksInLoop(blockBuilderToCfgBlock, blocksContainLoopCondition, basicBlockSet, this.blocks);
        const switchBuilder = new SwitchBuilder_1.SwitchBuilder();
        switchBuilder.buildSwitch(blockBuilderToCfgBlock, blockBuildersContainSwitch, valueAndStmtsOfSwitchAndCasesAll, arkIRTransformer, basicBlockSet);
        const conditionalBuilder = new ConditionBuilder_1.ConditionBuilder();
        conditionalBuilder.rebuildBlocksContainConditionalOperator(blockBuilderToCfgBlock, basicBlockSet, ModelUtils_1.ModelUtils.isArkUIBuilderMethod(this.declaringMethod));
    }
    createCfg(blockBuilderToCfgBlock, basicBlockSet) {
        const cfg = new Cfg_1.Cfg();
        const startingBasicBlock = blockBuilderToCfgBlock.get(this.blocks[0]);
        cfg.setStartingStmt(startingBasicBlock.getHead());
        let currBlockId = 0;
        for (const basicBlock of basicBlockSet) {
            basicBlock.setId(currBlockId++);
            cfg.addBlock(basicBlock);
        }
        for (const stmt of cfg.getStmts()) {
            stmt.setCfg(cfg);
        }
        this.topologicalSortBlock(cfg);
        return cfg;
    }
    topologicalSortBlock(cfg) {
        function dfs(block) {
            if (visited[block.getId()]) {
                return;
            }
            visited[block.getId()] = true;
            result.add(block);
            for (const succ of block.getSuccessors() || []) {
                dfs(succ);
            }
        }
        const startingBlock = cfg.getStartingBlock();
        if (!startingBlock) {
            return;
        }
        const blocks = cfg.getBlocks();
        const visited = new Array(blocks.size).fill(false);
        const result = new Set();
        dfs(startingBlock);
        // handle rest blocks haven't visted, which should be with no predecessorBlocks or the rest block in a block circle
        for (const block of blocks) {
            if (!visited[block.getId()]) {
                dfs(block);
            }
        }
        if (result.size === blocks.size) {
            cfg.setBlocks(result, false);
        }
    }
    linkBasicBlocks(blockBuilderToCfgBlock) {
        for (const [blockBuilder, cfgBlock] of blockBuilderToCfgBlock) {
            for (const successorBlockBuilder of blockBuilder.nexts) {
                if (!blockBuilderToCfgBlock.get(successorBlockBuilder)) {
                    continue;
                }
                const successorBlock = blockBuilderToCfgBlock.get(successorBlockBuilder);
                cfgBlock.addSuccessorBlock(successorBlock);
            }
            for (const predecessorBlockBuilder of blockBuilder.lasts) {
                if (!blockBuilderToCfgBlock.get(predecessorBlockBuilder)) {
                    continue;
                }
                const predecessorBlock = blockBuilderToCfgBlock.get(predecessorBlockBuilder);
                cfgBlock.addPredecessorBlock(predecessorBlock);
            }
        }
    }
    static replaceBlockBuilderAndBasicBlock(blockBuilderToCfgBlock, oldBlockBuilder, newBlockBuilder) {
        CfgBuilder.replaceBlockBuilder(oldBlockBuilder, newBlockBuilder);
        const oldBasicBlock = blockBuilderToCfgBlock.get(oldBlockBuilder);
        const newBasicBlock = blockBuilderToCfgBlock.get(newBlockBuilder);
        if (!oldBasicBlock || !newBasicBlock) {
            return;
        }
        CfgBuilder.replaceBasicBlock(oldBasicBlock, newBasicBlock);
    }
    static replaceBlockBuilder(oldBlockBuilder, newBlockBuilder) {
        CfgBuilder.replaceBlockBuilderInPredecessors(oldBlockBuilder, newBlockBuilder);
        CfgBuilder.replaceBlockBuilderInSuccessors(oldBlockBuilder, newBlockBuilder);
    }
    static replaceBlockBuilderInPredecessors(oldBlockBuilder, newBlockBuilder) {
        const predecessors = [...oldBlockBuilder.lasts];
        for (let predecessorIndex = 0; predecessorIndex < predecessors.length; predecessorIndex++) {
            const predecessor = predecessors[predecessorIndex];
            const successorIndex = predecessor.nexts.indexOf(oldBlockBuilder);
            if (successorIndex !== -1) {
                predecessor.nexts[successorIndex] = newBlockBuilder;
                oldBlockBuilder.lasts.splice(predecessorIndex, 1);
                newBlockBuilder.lasts.push(predecessor);
            }
            else {
                logger.trace(`replaceBlockBuilderInPredecessors: ${oldBlockBuilder.id} not found in ${predecessor.id}'s successors`);
            }
        }
    }
    static replaceBlockBuilderInSuccessors(oldBlockBuilder, newBlockBuilder) {
        const successors = [...oldBlockBuilder.nexts];
        for (let successorIndex = 0; successorIndex < successors.length; successorIndex++) {
            const successor = successors[successorIndex];
            const predecessorIndex = successor.lasts.indexOf(oldBlockBuilder);
            if (predecessorIndex !== -1) {
                successor.lasts[predecessorIndex] = newBlockBuilder;
                oldBlockBuilder.nexts.splice(successorIndex, 1);
                newBlockBuilder.nexts.push(successor);
            }
            else {
                logger.trace(`replaceBlockBuilderInSuccessors: ${oldBlockBuilder.id} not found in ${successor.id}'s predecessors`);
            }
        }
    }
    static unlinkPredecessorsOfBlockBuilder(blockBuilder) {
        const predecessors = [...blockBuilder.lasts];
        predecessors.forEach(predecessor => {
            CfgBuilder.unlinkBlockBuilder(predecessor, blockBuilder);
        });
    }
    static unlinkSuccessorsOfBlockBuilder(blockBuilder) {
        const successors = [...blockBuilder.nexts];
        successors.forEach(successor => {
            CfgBuilder.unlinkBlockBuilder(blockBuilder, successor);
        });
    }
    static unlinkBlockBuilder(predecessor, successor) {
        predecessor.removeSuccessorBlock(successor);
        successor.removePredecessorBlock(predecessor);
    }
    static unlinkPredecessorsAndSuccessorsOfBlockBuilder(blockBuilder) {
        CfgBuilder.unlinkPredecessorsOfBlockBuilder(blockBuilder);
        CfgBuilder.unlinkSuccessorsOfBlockBuilder(blockBuilder);
    }
    static pruneBlockBuilder(blockBuilder) {
        const successors = [...blockBuilder.nexts];
        if (successors.length > 1) {
            // can not handle multi successors
            return false;
        }
        else if (successors.length === 1) {
            CfgBuilder.replaceBlockBuilderInPredecessors(blockBuilder, successors[0]);
        }
        CfgBuilder.unlinkPredecessorsAndSuccessorsOfBlockBuilder(blockBuilder);
        return true;
    }
    static replaceBasicBlock(oldBasicBlock, newBasicBlock) {
        CfgBuilder.replaceBasicBlockInPredecessors(oldBasicBlock, newBasicBlock);
        CfgBuilder.replaceBasicBlockInSuccessors(oldBasicBlock, [newBasicBlock]);
    }
    // only 1 to 1
    static replaceBasicBlockInPredecessors(oldBasicBlock, newBasicBlock) {
        const predecessors = [...oldBasicBlock.getPredecessors()];
        for (const predecessor of predecessors) {
            const successorIndex = predecessor.getSuccessors().indexOf(oldBasicBlock);
            if (successorIndex !== -1) {
                // can not change positon in successors of predecessor
                predecessor.setSuccessorBlock(successorIndex, newBasicBlock);
                oldBasicBlock.removePredecessorBlock(predecessor);
                newBasicBlock.addPredecessorBlock(predecessor);
            }
            else {
                logger.trace(`replaceBasicBlockInPredecessors: ${oldBasicBlock.getId()} not found in ${predecessor.getId()}'s successors`);
            }
        }
    }
    static replaceBasicBlockInSuccessors(oldBasicBlock, newBasicBlocks) {
        const successors = [...oldBasicBlock.getSuccessors()];
        for (const successor of successors) {
            const predecessorIndex = successor.getPredecessors().indexOf(oldBasicBlock);
            if (predecessorIndex !== -1) {
                successor.removePredecessorBlock(oldBasicBlock);
                oldBasicBlock.removeSuccessorBlock(successor);
                newBasicBlocks.forEach(newBasicBlock => {
                    newBasicBlock.addSuccessorBlock(successor);
                    successor.addPredecessorBlock(newBasicBlock);
                });
            }
            else {
                logger.trace(`replaceBasicBlockInSuccessors: ${oldBasicBlock.getId()} not found in ${successor.getId()}'s predecessors`);
            }
        }
    }
    static linkPredecessorsOfBasicBlock(basicBlock, predecessors) {
        predecessors.forEach(predecessor => {
            CfgBuilder.linkBasicBlock(predecessor, basicBlock);
        });
    }
    static unlinkPredecessorsOfBasicBlock(basicBlock) {
        const predecessors = [...basicBlock.getPredecessors()];
        predecessors.forEach(predecessor => {
            CfgBuilder.unlinkBasicBlock(predecessor, basicBlock);
        });
    }
    static unlinkSuccessorsOfBasicBlock(basicBlock) {
        const successors = [...basicBlock.getSuccessors()];
        successors.forEach(successor => {
            CfgBuilder.unlinkBasicBlock(basicBlock, successor);
        });
    }
    static linkSuccessorOfIfBasicBlock(ifBasicBlock, trueBranchSuccessor, falseBranchSuccessor) {
        CfgBuilder.linkBasicBlock(ifBasicBlock, trueBranchSuccessor);
        CfgBuilder.linkBasicBlock(ifBasicBlock, falseBranchSuccessor);
    }
    static unlinkPredecessorsAndSuccessorsOfBasicBlock(basicBlock) {
        CfgBuilder.unlinkPredecessorsOfBasicBlock(basicBlock);
        CfgBuilder.unlinkSuccessorsOfBasicBlock(basicBlock);
    }
    static pruneBasicBlock(basicBlock) {
        const successors = [...basicBlock.getSuccessors()];
        if (successors.length > 1) {
            // can not handle multi successors
            return false;
        }
        else if (successors.length === 1) {
            CfgBuilder.replaceBasicBlockInPredecessors(basicBlock, successors[0]);
        }
        CfgBuilder.unlinkPredecessorsAndSuccessorsOfBasicBlock(basicBlock);
        return true;
    }
    static linkBasicBlock(predecessor, successor) {
        predecessor.addSuccessorBlock(successor);
        successor.addPredecessorBlock(predecessor);
    }
    static unlinkBasicBlock(predecessor, successor) {
        predecessor.removeSuccessorBlock(successor);
        successor.removePredecessorBlock(predecessor);
    }
    static linkExceptionalBasicBlock(predecessor, exceptionalSuccessor) {
        predecessor.addExceptionalSuccessorBlock(exceptionalSuccessor);
        exceptionalSuccessor.addExceptionalPredecessorBlock(predecessor);
    }
}
exports.CfgBuilder = CfgBuilder;
//# sourceMappingURL=CfgBuilder.js.map