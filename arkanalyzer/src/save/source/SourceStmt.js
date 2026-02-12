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
exports.SourceNewArrayExpr = exports.SourceFinallyStmt = exports.SourceCatchStmt = exports.SourceTryStmt = exports.SourceTypeAliasStmt = exports.SourceThrowStmt = exports.SourceCommonStmt = exports.SourceCompoundEndStmt = exports.SourceReturnVoidStmt = exports.SourceReturnStmt = exports.SourceBreakStmt = exports.SourceContinueStmt = exports.SourceElseStmt = exports.SourceDoWhileStmt = exports.SourceDoStmt = exports.SourceForStmt = exports.SourceWhileStmt = exports.SourceIfStmt = exports.SourceInvokeStmt = exports.SourceAssignStmt = exports.SourceStmt = void 0;
exports.stmt2SourceStmt = stmt2SourceStmt;
const Constant_1 = require("../../core/base/Constant");
const Expr_1 = require("../../core/base/Expr");
const Local_1 = require("../../core/base/Local");
const Ref_1 = require("../../core/base/Ref");
const Stmt_1 = require("../../core/base/Stmt");
const Type_1 = require("../../core/base/Type");
const logger_1 = __importStar(require("../../utils/logger"));
const SourceBody_1 = require("./SourceBody");
const SourceTransformer_1 = require("./SourceTransformer");
const PrinterUtils_1 = require("../base/PrinterUtils");
const ValueUtil_1 = require("../../core/common/ValueUtil");
const ArkClass_1 = require("../../core/model/ArkClass");
const ArkBaseModel_1 = require("../../core/model/ArkBaseModel");
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
const ArkImport_1 = require("../../core/model/ArkImport");
const ArkMethod_1 = require("../../core/model/ArkMethod");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SourceStmt');
const IGNOR_TYPES = new Set(['any', 'Map', 'Set']);
class SourceStmt {
    constructor(context, original) {
        this.text = '';
        this.original = original;
        this.context = context;
        this.line = original.getOriginPositionInfo().getLineNo();
        this.transformer = new SourceTransformer_1.SourceTransformer(context);
    }
    getLine() {
        return this.line;
    }
    setLine(line) {
        this.line = line;
    }
    dump() {
        this.beforeDump();
        let code = this.dumpTs();
        this.afterDump();
        return code;
    }
    beforeDump() { }
    afterDump() { }
    dumpTs() {
        let content = [];
        const commentsMetadata = this.original.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            const comments = commentsMetadata.getComments();
            comments.forEach(comment => {
                content.push(`${this.printer.getIndent()}${comment.content}\n`);
            });
        }
        if (this.text.length > 0) {
            content.push(`${this.printer.getIndent()}${this.text}\n`);
        }
        return content.join('');
    }
    get printer() {
        return this.context.getPrinter();
    }
    toString() {
        return this.text;
    }
    setText(text) {
        this.text = text;
    }
    getIntent() {
        return this.context.getPrinter().getIndent();
    }
    isLocalTempValue(value) {
        if (!(value instanceof Local_1.Local)) {
            return false;
        }
        return PrinterUtils_1.PrinterUtils.isTemp(value.getName());
    }
}
exports.SourceStmt = SourceStmt;
var AssignStmtDumpType;
(function (AssignStmtDumpType) {
    AssignStmtDumpType[AssignStmtDumpType["NORMAL"] = 0] = "NORMAL";
    AssignStmtDumpType[AssignStmtDumpType["TEMP_REPLACE"] = 1] = "TEMP_REPLACE";
    AssignStmtDumpType[AssignStmtDumpType["COMPONENT_CREATE"] = 2] = "COMPONENT_CREATE";
    AssignStmtDumpType[AssignStmtDumpType["PARAM_REPLACE"] = 3] = "PARAM_REPLACE";
})(AssignStmtDumpType || (AssignStmtDumpType = {}));
class SourceAssignStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
        this.leftOp = ValueUtil_1.ValueUtil.getUndefinedConst();
        this.rightOp = ValueUtil_1.ValueUtil.getUndefinedConst();
        this.leftCode = '';
        this.rightCode = '';
        this.leftTypeCode = '';
    }
    transfer2ts() {
        this.leftOp = this.original.getLeftOp();
        this.rightOp = this.original.getRightOp();
        if (this.rightOp instanceof Ref_1.ArkParameterRef) {
            this.setText('');
            this.dumpType = AssignStmtDumpType.PARAM_REPLACE;
            return;
        }
        if ((this.leftOp instanceof Local_1.Local && this.leftOp.getName() === 'this') ||
            (this.rightOp instanceof Constant_1.Constant && this.rightOp.getValue() === 'undefined') ||
            this.rightOp instanceof Ref_1.ClosureFieldRef) {
            this.setText('');
            this.dumpType = AssignStmtDumpType.NORMAL;
            return;
        }
        this.leftCode = this.transformer.valueToString(this.leftOp, true);
        if (this.leftOp instanceof Local_1.Local && this.rightOp instanceof Expr_1.ArkNewExpr) {
            this.transferRightNewExpr();
        }
        else if (this.leftOp instanceof Local_1.Local && this.rightOp instanceof Expr_1.ArkNewArrayExpr) {
            this.transferRightNewArrayExpr();
        }
        else if (this.rightOp instanceof Expr_1.ArkStaticInvokeExpr && PrinterUtils_1.PrinterUtils.isComponentCreate(this.rightOp)) {
            this.transferRightComponentCreate();
        }
        else if (this.rightOp instanceof Expr_1.ArkInstanceInvokeExpr && PrinterUtils_1.PrinterUtils.isConstructorInvoke(this.rightOp)) {
            this.transferConstructorInvokeExpr(this.rightOp);
        }
        else if (this.rightOp instanceof Expr_1.ArkInstanceInvokeExpr && PrinterUtils_1.PrinterUtils.isComponentAttributeInvoke(this.rightOp)) {
            this.transferRightComponentAttribute();
        }
        else {
            this.rightCode = this.transformer.valueToString(this.rightOp);
        }
        if (this.isLocalTempValue(this.leftOp)) {
            this.context.setTempCode(this.leftOp.getName(), this.rightCode);
        }
        if ((this.leftOp instanceof Ref_1.ArkInstanceFieldRef && this.leftOp.getBase().getName() === 'this') || this.leftOp instanceof Ref_1.ArkStaticFieldRef) {
            this.context.setTempCode(this.leftOp.getFieldName(), this.rightCode);
        }
        if (this.dumpType === undefined) {
            this.setText(`${this.leftCode} = ${this.rightCode}`);
            this.dumpType = AssignStmtDumpType.TEMP_REPLACE;
        }
        let leftOpType = this.leftOp.getType();
        if (leftOpType instanceof Type_1.ClassType) {
            let name = leftOpType.getClassSignature().getClassName();
            if (PrinterUtils_1.PrinterUtils.isAnonymousClass(name)) {
                this.leftTypeCode = 'any';
            }
            else {
                this.leftTypeCode = name;
            }
        }
        else {
            this.leftTypeCode = this.transformer.typeToString(leftOpType);
        }
        if (IGNOR_TYPES.has(this.leftTypeCode)) {
            this.leftTypeCode = '';
        }
    }
    beforeDump() {
        if (this.dumpType === AssignStmtDumpType.PARAM_REPLACE && this.leftOp instanceof Local_1.Local) {
            this.context.defineLocal(this.leftOp);
        }
        if (this.dumpType !== AssignStmtDumpType.TEMP_REPLACE) {
            return;
        }
        if (this.context.hasTempVisit(this.leftCode)) {
            this.setText('');
            return;
        }
        else if (PrinterUtils_1.PrinterUtils.isTemp(this.leftCode)) {
            this.setText(`${this.rightCode};`);
            return;
        }
        if (this.leftOp instanceof Local_1.Local && this.context.getLocals().has(this.leftOp.getName()) && !this.isLocalTempValue(this.leftOp)) {
            if (this.context.isLocalDefined(this.leftOp)) {
                this.setText(`${this.leftCode} = ${this.rightCode};`);
                return;
            }
            let flag = this.leftOp.getConstFlag() ? 'const' : 'let';
            if (this.context.getArkFile().getExportInfoBy(this.leftCode) && this.context.isInDefaultMethod()) {
                this.setText(`export ${flag} ${this.leftCode} = ${this.rightCode};`);
            }
            else {
                if (this.leftTypeCode.length > 0) {
                    this.setText(`${flag} ${this.leftCode}: ${this.leftTypeCode} = ${this.rightCode};`);
                }
                else {
                    this.setText(`${flag} ${this.leftCode} = ${this.rightCode};`);
                }
            }
            this.context.defineLocal(this.leftOp);
        }
        else {
            this.setText(`${this.leftCode} = ${this.rightCode};`);
        }
    }
    afterDump() {
        if (this.dumpType === AssignStmtDumpType.COMPONENT_CREATE) {
            this.printer.incIndent();
        }
    }
    getClassOriginType(type) {
        if (!(type instanceof Type_1.ClassType)) {
            return undefined;
        }
        let signature = type.getClassSignature();
        let cls = this.context.getClass(signature);
        if (!cls) {
            return undefined;
        }
        return PrinterUtils_1.PrinterUtils.getOriginType(cls);
    }
    /**
     * temp1 = new Person
     * temp1.constructor(10)
     */
    transferRightNewExpr() {
        let originType = this.getClassOriginType(this.rightOp.getType());
        if (this.context.getStmtReader().hasNext()) {
            let stmt = this.context.getStmtReader().next();
            let rollback = true;
            if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Expr_1.ArkInstanceInvokeExpr) {
                let instanceInvokeExpr = stmt.getRightOp();
                const methodName = instanceInvokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                if (('constructor' === methodName || 'construct-signature' === methodName) &&
                    instanceInvokeExpr.getBase().getName() === this.leftOp.getName()) {
                    this.handleConstructorInvoke(instanceInvokeExpr, originType);
                    return;
                }
            }
            if (rollback) {
                this.context.getStmtReader().rollback();
            }
        }
        if (originType === PrinterUtils_1.CLASS_CATEGORY_COMPONENT) {
            this.rightCode = `${this.transformer.typeToString(this.rightOp.getType())}()`;
        }
        else if (originType === ArkClass_1.ClassCategory.TYPE_LITERAL || originType === ArkClass_1.ClassCategory.OBJECT) {
            this.rightCode = `${this.transformer.typeToString(this.rightOp.getType())}`;
        }
        else {
            this.rightCode = `new ${this.transformer.typeToString(this.rightOp.getType())}()`;
        }
    }
    handleConstructorInvoke(instanceInvokeExpr, originType) {
        let args = [];
        instanceInvokeExpr.getArgs().forEach(v => {
            args.push(this.transformer.valueToString(v));
        });
        if (originType === PrinterUtils_1.CLASS_CATEGORY_COMPONENT) {
            this.rightCode = `${this.transformer.typeToString(this.rightOp.getType())}(${args.join(', ')})`;
        }
        else if (originType === ArkClass_1.ClassCategory.TYPE_LITERAL || originType === ArkClass_1.ClassCategory.OBJECT) {
            this.rightCode = `${this.transformer.literalObjectToString(this.rightOp.getType())}`;
        }
        else {
            this.rightCode = `new ${this.transformer.typeToString(this.rightOp.getType())}(${args.join(', ')})`;
        }
    }
    transferConstructorInvokeExpr(expr) {
        let rightCode = this.transformer.valueToString(this.rightOp);
        const pattern = /\([^)]*\)\.constructor/;
        this.rightCode = rightCode.replace(pattern, '');
        this.dumpType = AssignStmtDumpType.NORMAL;
    }
    /**
     * $temp0 = newarray[4]
     * $temp0[0] = 1
     * $temp0[1] = 2
     * $temp0[2] = 3
     */
    transferRightNewArrayExpr() {
        let arrayExpr = new SourceNewArrayExpr(this.rightOp);
        let localName = this.leftOp.getName();
        while (this.context.getStmtReader().hasNext()) {
            let stmt = this.context.getStmtReader().next();
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                let left = stmt.getLeftOp();
                if (left instanceof Ref_1.ArkArrayRef && left.getBase().getName() === localName) {
                    arrayExpr.addInitValue(this.transformer.valueToString(stmt.getRightOp()));
                }
                else {
                    this.context.getStmtReader().rollback();
                    break;
                }
            }
            else {
                this.context.getStmtReader().rollback();
                break;
            }
        }
        this.rightCode = arrayExpr.toString();
    }
    transferRightComponentCreate() {
        this.rightCode = this.transformer.valueToString(this.rightOp);
        if (this.context.getStmtReader().hasNext()) {
            let stmt = this.context.getStmtReader().next();
            if (stmt instanceof Stmt_1.ArkInvokeStmt) {
                let expr = stmt.getInvokeExpr();
                if (expr instanceof Expr_1.ArkStaticInvokeExpr && PrinterUtils_1.PrinterUtils.isComponentPop(expr)) {
                    this.setText(`${this.rightCode}`);
                    this.dumpType = AssignStmtDumpType.NORMAL;
                    return;
                }
            }
            this.context.getStmtReader().rollback();
        }
        this.setText(`${this.rightCode} {`);
        this.dumpType = AssignStmtDumpType.COMPONENT_CREATE;
    }
    transferRightComponentAttribute() {
        this.rightCode = this.transformer.valueToString(this.rightOp);
        this.setText(`${this.rightCode}`);
        this.dumpType = AssignStmtDumpType.NORMAL;
    }
}
exports.SourceAssignStmt = SourceAssignStmt;
class SourceInvokeStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    transfer2ts() {
        let invokeExpr = this.original.getInvokeExpr();
        let code = '';
        let isAttr = false;
        if (invokeExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            if (PrinterUtils_1.PrinterUtils.isComponentPop(invokeExpr)) {
                code = '}';
                isAttr = true;
            }
            else {
                code = this.transformer.staticInvokeExprToString(invokeExpr);
                isAttr = PrinterUtils_1.PrinterUtils.isComponentIfElseInvoke(invokeExpr);
            }
        }
        else if (invokeExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            isAttr = PrinterUtils_1.PrinterUtils.isComponentAttributeInvoke(invokeExpr);
            code = this.transformer.instanceInvokeExprToString(invokeExpr, isAttr);
        }
        if (code.length > 0 && !isAttr) {
            this.setText(`${code};`);
        }
        else {
            this.setText(`${code}`);
        }
    }
    beforeDump() {
        let invokeExpr = this.original.getInvokeExpr();
        if ((invokeExpr instanceof Expr_1.ArkStaticInvokeExpr && PrinterUtils_1.PrinterUtils.isComponentPop(invokeExpr)) ||
            (invokeExpr instanceof Expr_1.ArkStaticInvokeExpr && PrinterUtils_1.PrinterUtils.isComponentIfElseInvoke(invokeExpr))) {
            this.printer.decIndent();
            return;
        }
    }
    afterDump() {
        let invokeExpr = this.original.getInvokeExpr();
        if (invokeExpr instanceof Expr_1.ArkStaticInvokeExpr && PrinterUtils_1.PrinterUtils.isComponentIfElseInvoke(invokeExpr)) {
            this.printer.incIndent();
            return;
        }
    }
}
exports.SourceInvokeStmt = SourceInvokeStmt;
class SourceIfStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    transfer2ts() {
        let code;
        let expr = this.original.getConditionExpr();
        code = `if (${this.transformer.valueToString(expr.getOp1())}`;
        code += ` ${expr.getOperator()} `;
        code += `${this.transformer.valueToString(expr.getOp2())}) {`;
        this.setText(code);
    }
    afterDump() {
        this.printer.incIndent();
    }
}
exports.SourceIfStmt = SourceIfStmt;
class SourceWhileStmt extends SourceStmt {
    constructor(context, original, block) {
        super(context, original);
        this.block = block;
    }
    afterDump() {
        this.printer.incIndent();
    }
    /**
     * $temp2 = $temp1.next()
     * $temp3 = $temp2.done()
     * if $temp3 === true
     *  $temp4 = $temp2.value
     *  $temp5 = <> cast
     * @returns
     */
    forOf2ts() {
        let expr = this.original.getConditionExpr();
        let temp3 = expr.getOp1();
        let op2 = expr.getOp2();
        let firstStmt = this.context.getStmtReader().first();
        if (!(firstStmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        if (!(this.isLocalTempValue(temp3) && op2 instanceof Constant_1.Constant && op2.getValue() === 'true')) {
            return false;
        }
        let stmt = temp3.getDeclaringStmt();
        if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        let done = stmt.getRightOp();
        if (!(done instanceof Ref_1.ArkInstanceFieldRef)) {
            return false;
        }
        if (done.getFieldSignature().toString() !== '@ES2015/BuiltinClass: IteratorResult.done') {
            return false;
        }
        let temp2 = done.getBase();
        stmt = temp2.getDeclaringStmt();
        if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        let next = stmt.getRightOp();
        if (!(next instanceof Expr_1.ArkInstanceInvokeExpr)) {
            return false;
        }
        if (next.getMethodSignature().getMethodSubSignature().getMethodName() !== 'next') {
            return false;
        }
        let temp1 = next.getBase();
        stmt = temp1.getDeclaringStmt();
        if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        let iterator = stmt.getRightOp();
        if (!(iterator instanceof Expr_1.ArkInstanceInvokeExpr)) {
            return false;
        }
        if (iterator.getMethodSignature().getMethodSubSignature().getMethodName() !== 'Symbol.iterator') {
            return false;
        }
        return this.getForOf2ts(temp3, temp1, iterator);
    }
    getForOf2ts(temp3, temp1, iterator) {
        let successors = this.block.getSuccessors();
        if (successors.length !== 2) {
            return false;
        }
        let stmts = successors[0].getStmts();
        if (stmts.length < 2) {
            return false;
        }
        let stmt = stmts[1];
        if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        this.context.setSkipStmt(stmts[0]);
        this.context.setSkipStmt(stmts[1]);
        while (this.context.getStmtReader().hasNext()) {
            this.context.getStmtReader().next();
        }
        let v = stmt.getLeftOp();
        let valueName = v.getName();
        if (!this.isLocalTempValue(v)) {
            this.setText(`for (let ${valueName} of ${this.transformer.valueToString(iterator.getBase())}) {`);
            this.context.setTempVisit(temp1.getName());
            this.context.setTempVisit(temp3.getName());
            return true;
        }
        // iterate map 'for (let [key, value] of map)'
        let stmtReader = new SourceBody_1.StmtReader(stmts);
        stmtReader.next();
        stmtReader.next();
        let arrayValueNames = [];
        while (stmtReader.hasNext()) {
            stmt = stmtReader.next();
            if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
                break;
            }
            let ref = stmt.getRightOp();
            if (!(ref instanceof Ref_1.ArkArrayRef)) {
                break;
            }
            if (ref.getBase().getName() !== valueName) {
                break;
            }
            let name = stmt.getLeftOp().getName();
            arrayValueNames.push(name);
            this.context.setTempVisit(name);
        }
        this.setText(`for (let [${arrayValueNames.join(', ')}] of ${this.transformer.valueToString(iterator.getBase())}) {`);
        this.context.setTempVisit(temp3.getName());
        return true;
    }
    transfer2ts() {
        if (this.forOf2ts()) {
            return;
        }
        let code;
        let expr = this.original.getConditionExpr();
        code = `while (${this.valueToString(expr.getOp1())}`;
        code += ` ${expr.getOperator().trim()} `;
        code += `${this.valueToString(expr.getOp2())}) {`;
        this.setText(code);
    }
    valueToString(value) {
        if (!(value instanceof Local_1.Local)) {
            return this.transformer.valueToString(value);
        }
        for (const stmt of this.block.getStmts()) {
            if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
                continue;
            }
            if (PrinterUtils_1.PrinterUtils.isDeIncrementStmt(stmt, Expr_1.NormalBinaryOperator.Addition) && stmt.getLeftOp().getName() === value.getName()) {
                this.context.setSkipStmt(stmt);
                return `${value.getName()}++`;
            }
            if (PrinterUtils_1.PrinterUtils.isDeIncrementStmt(stmt, Expr_1.NormalBinaryOperator.Subtraction) && stmt.getLeftOp().getName() === value.getName()) {
                this.context.setSkipStmt(stmt);
                return `${value.getName()}--`;
            }
        }
        return this.transformer.valueToString(value);
    }
}
exports.SourceWhileStmt = SourceWhileStmt;
class SourceForStmt extends SourceWhileStmt {
    constructor(context, original, block, incBlock) {
        super(context, original, block);
        this.incBlock = incBlock;
    }
    transfer2ts() {
        let code;
        let expr = this.original.getConditionExpr();
        code = `for (; ${this.transformer.valueToString(expr.getOp1())}`;
        code += ` ${expr.getOperator().trim()} `;
        code += `${this.transformer.valueToString(expr.getOp2())}; `;
        let stmtReader = new SourceBody_1.StmtReader(this.incBlock.getStmts());
        while (stmtReader.hasNext()) {
            let sourceStmt = stmt2SourceStmt(this.context, stmtReader.next());
            sourceStmt.transfer2ts();
            code += sourceStmt.toString();
            if (stmtReader.hasNext()) {
                code += ', ';
            }
        }
        code += `) {`;
        this.setText(code);
    }
}
exports.SourceForStmt = SourceForStmt;
class SourceDoStmt extends SourceStmt {
    constructor(context, stmt) {
        super(context, stmt);
    }
    transfer2ts() {
        this.setText('do {');
    }
    afterDump() {
        this.printer.incIndent();
    }
}
exports.SourceDoStmt = SourceDoStmt;
class SourceDoWhileStmt extends SourceWhileStmt {
    constructor(context, stmt, block) {
        super(context, stmt, block);
    }
    transfer2ts() {
        let code;
        let expr = this.original.getConditionExpr();
        code = `} while (${this.valueToString(expr.getOp1())}`;
        code += ` ${expr.getOperator().trim()} `;
        code += `${this.valueToString(expr.getOp2())})`;
        this.setText(code);
    }
    beforeDump() {
        this.printer.decIndent();
    }
    afterDump() { }
}
exports.SourceDoWhileStmt = SourceDoWhileStmt;
class SourceElseStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    transfer2ts() {
        this.setText('} else {');
    }
    beforeDump() {
        this.printer.decIndent();
    }
    afterDump() {
        this.printer.incIndent();
    }
}
exports.SourceElseStmt = SourceElseStmt;
class SourceContinueStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    // trans 2 break or continue
    transfer2ts() {
        this.setText('continue;');
    }
}
exports.SourceContinueStmt = SourceContinueStmt;
class SourceBreakStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    // trans 2 break or continue
    transfer2ts() {
        this.setText('break;');
    }
}
exports.SourceBreakStmt = SourceBreakStmt;
class SourceReturnStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    transfer2ts() {
        this.setText(`return ${this.transformer.valueToString(this.original.getOp())};`);
    }
}
exports.SourceReturnStmt = SourceReturnStmt;
class SourceReturnVoidStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    transfer2ts() {
        if (this.original.getOriginPositionInfo().getLineNo() <= 0) {
            this.setText('');
        }
        else {
            this.setText('return;');
        }
    }
}
exports.SourceReturnVoidStmt = SourceReturnVoidStmt;
class SourceCompoundEndStmt extends SourceStmt {
    constructor(context, stmt, text) {
        super(context, stmt);
        this.setText(text);
    }
    transfer2ts() { }
    beforeDump() {
        this.printer.decIndent();
    }
}
exports.SourceCompoundEndStmt = SourceCompoundEndStmt;
class SourceCommonStmt extends SourceStmt {
    constructor(context, stmt) {
        super(context, stmt);
    }
    transfer2ts() {
        this.setText(this.original.toString());
    }
}
exports.SourceCommonStmt = SourceCommonStmt;
class SourceThrowStmt extends SourceStmt {
    constructor(context, original) {
        super(context, original);
    }
    transfer2ts() {
        this.setText(`throw ${this.transformer.valueToString(this.original.getOp())};`);
    }
}
exports.SourceThrowStmt = SourceThrowStmt;
class SourceTypeAliasStmt extends SourceStmt {
    constructor(context, original, aliasType) {
        super(context, original);
        this.aliasType = aliasType;
    }
    transfer2ts() {
        let modifiersArray = (0, ArkBaseModel_1.modifiers2stringArray)(this.aliasType.getModifiers());
        let modifier = modifiersArray.length > 0 ? `${modifiersArray.join(' ')} ` : '';
        const expr = this.original.getAliasTypeExpr();
        let typeOf = expr.getTransferWithTypeOf() ? 'typeof ' : '';
        let realGenericTypes = expr.getRealGenericTypes() ? `<${expr.getRealGenericTypes().join(', ')}>` : '';
        let genericTypes = this.aliasType.getGenericTypes() ? `<${this.transformer.typeArrayToString(this.aliasType.getGenericTypes())}>` : '';
        let typeObject = expr.getOriginalObject();
        if (typeObject instanceof Type_1.Type) {
            if (typeObject instanceof Type_1.AliasType) {
                this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${typeObject.getName()}${realGenericTypes};`);
            }
            else if (typeObject instanceof Type_1.ClassType) {
                this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${this.transformer.typeToString(typeObject)};`);
            }
            else if (typeObject instanceof Type_1.FunctionType) {
                this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${typeObject.getMethodSignature().getMethodSubSignature().getMethodName()}${realGenericTypes};`);
            }
            else {
                this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${this.transformer.typeToString(typeObject)}${realGenericTypes};`);
            }
            return;
        }
        if (typeObject instanceof ArkImport_1.ImportInfo) {
            let exprStr = `import('${typeObject.getFrom()}')`;
            if (typeObject.getImportClauseName() !== '') {
                exprStr = `${exprStr}.${typeObject.getImportClauseName()}`;
            }
            this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${exprStr}${realGenericTypes};`);
            return;
        }
        if (typeObject instanceof Local_1.Local) {
            this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${this.transformer.valueToString(typeObject)}${realGenericTypes};`);
            return;
        }
        if (typeObject instanceof ArkClass_1.ArkClass) {
            let classTS = this.generateClassTS(typeObject);
            this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${classTS}${realGenericTypes};`);
            return;
        }
        if (typeObject instanceof ArkMethod_1.ArkMethod) {
            this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${typeObject.getName()}${realGenericTypes};`);
            return;
        }
        this.setText(`${modifier}type ${this.aliasType.getName()}${genericTypes} = ${typeOf}${typeObject.getName()}${realGenericTypes};`);
    }
    generateClassTS(arkClass) {
        let res = '';
        let classType = new Type_1.ClassType(arkClass.getSignature());
        if (arkClass.getCategory() === ArkClass_1.ClassCategory.TYPE_LITERAL || arkClass.getCategory() === ArkClass_1.ClassCategory.OBJECT) {
            res = this.transformer.literalObjectToString(classType);
        }
        else {
            res = this.transformer.typeToString(classType);
        }
        return res;
    }
}
exports.SourceTypeAliasStmt = SourceTypeAliasStmt;
class SourceTryStmt extends SourceStmt {
    constructor(context, stmt) {
        super(context, stmt);
    }
    transfer2ts() {
        this.setText('try {');
    }
    afterDump() {
        this.printer.incIndent();
    }
}
exports.SourceTryStmt = SourceTryStmt;
class SourceCatchStmt extends SourceStmt {
    constructor(context, stmt, block) {
        super(context, stmt);
        this.block = block;
    }
    transfer2ts() {
        if (this.block) {
            let stmt = this.block.getHead();
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                if (stmt.getLeftOp() instanceof Local_1.Local) {
                    let name = stmt.getLeftOp().getName();
                    this.setText(`} catch (${name}) {`);
                    this.context.setSkipStmt(stmt);
                    return;
                }
            }
        }
        this.setText('} catch (e) {');
    }
    beforeDump() {
        this.printer.decIndent();
    }
    afterDump() {
        this.printer.incIndent();
    }
}
exports.SourceCatchStmt = SourceCatchStmt;
class SourceFinallyStmt extends SourceStmt {
    constructor(context, stmt) {
        super(context, stmt);
    }
    transfer2ts() {
        this.setText('} finally {');
    }
    beforeDump() {
        this.printer.decIndent();
    }
    afterDump() {
        this.printer.incIndent();
    }
}
exports.SourceFinallyStmt = SourceFinallyStmt;
class SourceNewArrayExpr {
    constructor(expr) {
        this.expr = expr;
        this.values = [];
    }
    addInitValue(value) {
        this.values.push(value);
    }
    toString() {
        return `[${this.values.join(', ')}]`;
    }
}
exports.SourceNewArrayExpr = SourceNewArrayExpr;
function stmt2SourceStmt(context, stmt) {
    if (stmt instanceof Stmt_1.ArkAssignStmt) {
        return new SourceAssignStmt(context, stmt);
    }
    if (stmt instanceof Stmt_1.ArkInvokeStmt) {
        return new SourceInvokeStmt(context, stmt);
    }
    if (stmt instanceof Stmt_1.ArkReturnVoidStmt) {
        return new SourceReturnVoidStmt(context, stmt);
    }
    if (stmt instanceof Stmt_1.ArkReturnStmt) {
        return new SourceReturnStmt(context, stmt);
    }
    if (stmt instanceof Stmt_1.ArkThrowStmt) {
        return new SourceThrowStmt(context, stmt);
    }
    if (stmt instanceof Stmt_1.ArkAliasTypeDefineStmt) {
        return new SourceTypeAliasStmt(context, stmt, stmt.getAliasType());
    }
    logger.info(`stmt2SourceStmt ${stmt.constructor} not support.`);
    return new SourceCommonStmt(context, stmt);
}
//# sourceMappingURL=SourceStmt.js.map