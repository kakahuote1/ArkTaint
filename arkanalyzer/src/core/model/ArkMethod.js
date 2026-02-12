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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkMethod = exports.arkMethodNodeKind = void 0;
const Ref_1 = require("../base/Ref");
const Stmt_1 = require("../base/Stmt");
const Type_1 = require("../base/Type");
const ArkClass_1 = require("./ArkClass");
const ArkExport_1 = require("./ArkExport");
const Const_1 = require("../common/Const");
const Position_1 = require("../base/Position");
const ArkBaseModel_1 = require("./ArkBaseModel");
const ArkError_1 = require("../common/ArkError");
const TSConst_1 = require("../common/TSConst");
const ModelUtils_1 = require("../common/ModelUtils");
exports.arkMethodNodeKind = [
    'MethodDeclaration',
    'Constructor',
    'FunctionDeclaration',
    'GetAccessor',
    'SetAccessor',
    'ArrowFunction',
    'FunctionExpression',
    'MethodSignature',
    'ConstructSignature',
    'CallSignature',
];
/**
 * @category core/model
 */
class ArkMethod extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.isGeneratedFlag = false;
        this.asteriskToken = false;
        this.questionToken = false;
    }
    /**
     * Returns the program language of the file where this method defined.
     */
    getLanguage() {
        return this.getDeclaringArkClass().getLanguage();
    }
    getExportType() {
        return ArkExport_1.ExportType.METHOD;
    }
    getName() {
        return this.getSignature().getMethodSubSignature().getMethodName();
    }
    /**
     * Returns the codes of method as a **string.**
     * @returns the codes of method.
     */
    getCode() {
        return this.code;
    }
    setCode(code) {
        this.code = code;
    }
    /**
     * Get all lines of the method's declarations or null if the method has no seperated declaration.
     * @returns null or the lines of the method's declarations with number type.
     */
    getDeclareLines() {
        if (this.methodDeclareLineCols === undefined) {
            return null;
        }
        let lines = [];
        this.methodDeclareLineCols.forEach(lineCol => {
            lines.push((0, Position_1.getLineNo)(lineCol));
        });
        return lines;
    }
    /**
     * Get all columns of the method's declarations or null if the method has no seperated declaration.
     * @returns null or the columns of the method's declarations with number type.
     */
    getDeclareColumns() {
        if (this.methodDeclareLineCols === undefined) {
            return null;
        }
        let columns = [];
        this.methodDeclareLineCols.forEach(lineCol => {
            columns.push((0, Position_1.getColNo)(lineCol));
        });
        return columns;
    }
    /**
     * Set lines and columns of the declarations with number type inputs and then encoded them to LineCol type.
     * The length of lines and columns should be the same otherwise they cannot be encoded together.
     * @param lines - the number of lines.
     * @param columns - the number of columns.
     * @returns
     */
    setDeclareLinesAndCols(lines, columns) {
        if (lines?.length !== columns?.length) {
            return;
        }
        this.methodDeclareLineCols = [];
        lines.forEach((line, index) => {
            let lineCol = 0;
            lineCol = (0, Position_1.setLine)(lineCol, line);
            lineCol = (0, Position_1.setCol)(lineCol, columns[index]);
            this.methodDeclareLineCols.push(lineCol);
        });
    }
    /**
     * Set lineCols of the declarations directly with LineCol type input.
     * @param lineCols - the encoded lines and columns with LineCol type.
     * @returns
     */
    setDeclareLineCols(lineCols) {
        this.methodDeclareLineCols = lineCols;
    }
    /**
     * Get encoded lines and columns of the method's declarations or null if the method has no seperated declaration.
     * @returns null or the encoded lines and columns of the method's declarations with LineCol type.
     */
    getDeclareLineCols() {
        return this.methodDeclareLineCols ?? null;
    }
    /**
     * Get line of the method's implementation or null if the method has no implementation.
     * @returns null or the number of the line.
     */
    getLine() {
        if (this.lineCol === undefined) {
            return null;
        }
        return (0, Position_1.getLineNo)(this.lineCol);
    }
    /**
     * Set line of the implementation with line number input.
     * The line number will be encoded together with the original column number.
     * @param line - the line number of the method implementation.
     * @returns
     */
    setLine(line) {
        if (this.lineCol === undefined) {
            this.lineCol = 0;
        }
        this.lineCol = (0, Position_1.setLine)(this.lineCol, line);
    }
    /**
     * Get column of the method's implementation or null if the method has no implementation.
     * @returns null or the number of the column.
     */
    getColumn() {
        if (this.lineCol === undefined) {
            return null;
        }
        return (0, Position_1.getColNo)(this.lineCol);
    }
    /**
     * Set column of the implementation with column number input.
     * The column number will be encoded together with the original line number.
     * @param column - the column number of the method implementation.
     * @returns
     */
    setColumn(column) {
        if (this.lineCol === undefined) {
            this.lineCol = 0;
        }
        this.lineCol = (0, Position_1.setCol)(this.lineCol, column);
    }
    /**
     * Get encoded line and column of the method's implementation or null if the method has no implementation.
     * @returns null or the encoded line and column of the method's implementation with LineCol type.
     */
    getLineCol() {
        return this.lineCol ?? null;
    }
    /**
     * Set lineCol of the implementation directly with LineCol type input.
     * @param lineCol - the encoded line and column with LineCol type.
     * @returns
     */
    setLineCol(lineCol) {
        this.lineCol = lineCol;
    }
    /**
     * Returns the declaring class of the method.
     * @returns The declaring class of the method.
     */
    getDeclaringArkClass() {
        return this.declaringArkClass;
    }
    setDeclaringArkClass(declaringArkClass) {
        this.declaringArkClass = declaringArkClass;
    }
    getDeclaringArkFile() {
        return this.declaringArkClass.getDeclaringArkFile();
    }
    isDefaultArkMethod() {
        return this.getName() === Const_1.DEFAULT_ARK_METHOD_NAME;
    }
    isAnonymousMethod() {
        return this.getName().startsWith(Const_1.ANONYMOUS_METHOD_PREFIX);
    }
    getParameters() {
        return this.getSignature().getMethodSubSignature().getParameters();
    }
    getReturnType() {
        return this.getSignature().getType();
    }
    /**
     * Get all declare signatures.
     * The results could be null if there is no seperated declaration of the method.
     * @returns null or the method declare signatures.
     */
    getDeclareSignatures() {
        return this.methodDeclareSignatures ?? null;
    }
    /**
     * Get the index of the matched method declare signature among all declare signatures.
     * The index will be -1 if there is no matched signature found.
     * @param targetSignature - the target declare signature want to search.
     * @returns -1 or the index of the matched signature.
     */
    getDeclareSignatureIndex(targetSignature) {
        let declareSignatures = this.methodDeclareSignatures;
        if (declareSignatures === undefined) {
            return -1;
        }
        for (let i = 0; i < declareSignatures.length; i++) {
            if (declareSignatures[i].isMatch(targetSignature)) {
                return i;
            }
        }
        return -1;
    }
    /**
     * Get the method signature of the implementation.
     * The signature could be null if the method is only a declaration which body is undefined.
     * @returns null or the method implementation signature.
     */
    getImplementationSignature() {
        return this.methodSignature ?? null;
    }
    /**
     * Get the method signature of the implementation or the first declaration if there is no implementation.
     * For a method, the implementation and declaration signatures must not be undefined at the same time.
     * A {@link MethodSignature} includes:
     * - Class Signature: indicates which class this method belong to.
     * - Method SubSignature: indicates the detail info of this method such as method name, parameters, returnType, etc.
     * @returns The method signature.
     * @example
     * 1. Get the signature of method mtd.

     ```typescript
     let signature = mtd.getSignature();
     // ... ...
     ```
     */
    getSignature() {
        return this.methodSignature ?? this.methodDeclareSignatures[0];
    }
    /**
     * Set signatures of all declarations.
     * It will reset the declaration signatures if they are already defined before.
     * @param signatures - one signature or a list of signatures.
     * @returns
     */
    setDeclareSignatures(signatures) {
        if (Array.isArray(signatures)) {
            this.methodDeclareSignatures = signatures;
        }
        else {
            this.methodDeclareSignatures = [signatures];
        }
    }
    /**
     * Reset signature of one declaration with the specified index.
     * Will do nothing if the index doesn't exist.
     * @param signature - new signature want to set.
     * @param index - index of signature want to set.
     * @returns
     */
    setDeclareSignatureWithIndex(signature, index) {
        if (this.methodDeclareSignatures === undefined || this.methodDeclareSignatures.length <= index) {
            return;
        }
        this.methodDeclareSignatures[index] = signature;
    }
    /**
     * Set signature of implementation.
     * It will reset the implementation signature if it is already defined before.
     * @param signature - signature of implementation.
     * @returns
     */
    setImplementationSignature(signature) {
        this.methodSignature = signature;
    }
    getSubSignature() {
        return this.getSignature().getMethodSubSignature();
    }
    getGenericTypes() {
        return this.genericTypes;
    }
    isGenericsMethod() {
        return this.genericTypes !== undefined;
    }
    setGenericTypes(genericTypes) {
        this.genericTypes = genericTypes;
    }
    getBodyBuilder() {
        return this.bodyBuilder;
    }
    /**
     * Get {@link ArkBody} of a Method.
     * A {@link ArkBody} contains the CFG and actual instructions or operations to be executed for a method.
     * It is analogous to the body of a function or method in high-level programming languages,
     * which contains the statements and expressions that define what the function does.
     * @returns The {@link ArkBody} of a method.
     * @example
     * 1. Get cfg or stmt through ArkBody.

     ```typescript
     let cfg = this.scene.getMethod()?.getBody().getCfg();
     const body = arkMethod.getBody()
     ```

     2. Get local variable through ArkBody.

     ```typescript
     arkClass.getDefaultArkMethod()?.getBody().getLocals.forEach(local=>{...})
     let locals = arkFile().getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals();
     ```
     */
    getBody() {
        return this.body;
    }
    setBody(body) {
        this.body = body;
    }
    /**
     * Get the CFG (i.e., control flow graph) of a method.
     * The CFG is a graphical representation of all possible control flow paths within a method's body.
     * A CFG consists of blocks, statements and goto control jumps.
     * @returns The CFG (i.e., control flow graph) of a method.
     * @example
     * 1. get stmt through ArkBody cfg.

     ```typescript
     body = arkMethod.getBody();
     const cfg = body.getCfg();
     for (const threeAddressStmt of cfg.getStmts()) {
     ... ...
     }
     ```

     2. get blocks through ArkBody cfg.

     ```typescript
     const body = arkMethod.getBody();
     const blocks = [...body.getCfg().getBlocks()];
     for (let i=0; i<blocks.length; i++) {
     const block = blocks[i];
     ... ...
     for (const stmt of block.getStmts()) {
     ... ...
     }
     let text = "next;"
     for (const next of block.getSuccessors()) {
     text += blocks.indexOf(next) + ' ';
     }
     // ... ...
     }
     ```
     */
    getCfg() {
        return this.body?.getCfg();
    }
    getOriginalCfg() {
        return undefined;
    }
    getParameterRefs() {
        let paramRefs = [];
        const stmts = this.getBody()?.getCfg().getStartingBlock()?.getStmts();
        if (stmts === undefined) {
            return null;
        }
        for (let stmt of stmts) {
            if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Ref_1.ArkParameterRef) {
                paramRefs.push(stmt.getRightOp());
            }
        }
        return paramRefs;
    }
    getParameterInstances() {
        // 获取方法体中参数Local实例
        let stmts = [];
        if (this.getCfg()) {
            const cfg = this.getCfg();
            cfg.getStmts().forEach(stmt => stmts.push(stmt));
        }
        let results = [];
        for (let stmt of stmts) {
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                if (stmt.getRightOp() instanceof Ref_1.ArkParameterRef) {
                    results.push(stmt.getLeftOp());
                }
            }
            if (results.length === this.getParameters().length) {
                return results;
            }
        }
        return results;
    }
    getThisInstance() {
        // 获取方法体中This实例
        let stmts = [];
        if (this.getCfg()) {
            const cfg = this.getCfg();
            cfg.getStmts().forEach(stmt => stmts.push(stmt));
        }
        for (let stmt of stmts) {
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                if (stmt.getRightOp() instanceof Ref_1.ArkThisRef) {
                    return stmt.getLeftOp();
                }
            }
        }
        return null;
    }
    getReturnValues() {
        // 获取方法体中return值实例
        let resultValues = [];
        this.getCfg()
            ?.getStmts()
            .forEach(stmt => {
            if (stmt instanceof Stmt_1.ArkReturnStmt) {
                resultValues.push(stmt.getOp());
            }
        });
        return resultValues;
    }
    getReturnStmt() {
        return (this.getCfg()
            ?.getStmts()
            .filter(stmt => stmt instanceof Stmt_1.ArkReturnStmt) ?? []);
    }
    getReturnVoidStmt() {
        return (this.getCfg()
            ?.getStmts()
            .filter(stmt => stmt instanceof Stmt_1.ArkReturnVoidStmt) ?? []);
    }
    setViewTree(viewTree) {
        this.viewTree = viewTree;
    }
    getViewTree() {
        return this.viewTree;
    }
    hasViewTree() {
        return this.viewTree !== undefined;
    }
    setBodyBuilder(bodyBuilder) {
        this.bodyBuilder = bodyBuilder;
        if (this.getDeclaringArkFile().getScene().buildClassDone()) {
            this.buildBody();
        }
    }
    freeBodyBuilder() {
        this.bodyBuilder = undefined;
    }
    buildBody() {
        if (this.bodyBuilder) {
            const arkBody = this.bodyBuilder.build();
            if (arkBody) {
                this.setBody(arkBody);
                arkBody.getCfg().setDeclaringMethod(this);
                if (this.getOuterMethod() === undefined) {
                    this.bodyBuilder.handleGlobalAndClosure();
                }
            }
        }
    }
    isGenerated() {
        return this.isGeneratedFlag;
    }
    setIsGeneratedFlag(isGeneratedFlag) {
        this.isGeneratedFlag = isGeneratedFlag;
    }
    getAsteriskToken() {
        return this.asteriskToken;
    }
    setAsteriskToken(asteriskToken) {
        this.asteriskToken = asteriskToken;
    }
    validate() {
        const declareSignatures = this.getDeclareSignatures();
        const declareLineCols = this.getDeclareLineCols();
        const signature = this.getImplementationSignature();
        const lineCol = this.getLineCol();
        if (declareSignatures === null && signature === null) {
            return {
                errCode: ArkError_1.ArkErrorCode.METHOD_SIGNATURE_UNDEFINED,
                errMsg: 'methodDeclareSignatures and methodSignature are both undefined.',
            };
        }
        if ((declareSignatures === null) !== (declareLineCols === null)) {
            return {
                errCode: ArkError_1.ArkErrorCode.METHOD_SIGNATURE_LINE_UNMATCHED,
                errMsg: 'methodDeclareSignatures and methodDeclareLineCols are not matched.',
            };
        }
        if (declareSignatures !== null && declareLineCols !== null && declareSignatures.length !== declareLineCols.length) {
            return {
                errCode: ArkError_1.ArkErrorCode.METHOD_SIGNATURE_LINE_UNMATCHED,
                errMsg: 'methodDeclareSignatures and methodDeclareLineCols are not matched.',
            };
        }
        if ((signature === null) !== (lineCol === null)) {
            return {
                errCode: ArkError_1.ArkErrorCode.METHOD_SIGNATURE_LINE_UNMATCHED,
                errMsg: 'methodSignature and lineCol are not matched.',
            };
        }
        return this.validateFields(['declaringArkClass']);
    }
    matchMethodSignature(args) {
        const signatures = this.methodDeclareSignatures?.filter(f => {
            const parameters = f.getMethodSubSignature().getParameters();
            const max = parameters.length;
            let min = 0;
            while (min < max && !parameters[min].isOptional()) {
                min++;
            }
            return args.length >= min && args.length <= max;
        });
        return (signatures?.find(p => ModelUtils_1.ModelUtils.isMatched(p.getMethodSubSignature().getParameters(), args, this.getDeclaringArkFile().getScene())) ??
            signatures?.[0] ??
            this.getSignature());
    }
    getOuterMethod() {
        return this.outerMethod;
    }
    setOuterMethod(method) {
        this.outerMethod = method;
    }
    getFunctionLocal(name) {
        const local = this.getBody()?.getLocals().get(name);
        return local?.getType() instanceof Type_1.FunctionType ? local : null;
    }
    setQuestionToken(questionToken) {
        this.questionToken = questionToken;
    }
    getQuestionToken() {
        return this.questionToken;
    }
    // For class method, if there is no public/private/protected access modifier, it is actually public
    isPublic() {
        if (!this.containsModifier(ArkBaseModel_1.ModifierType.PUBLIC) &&
            !this.containsModifier(ArkBaseModel_1.ModifierType.PRIVATE) &&
            !this.containsModifier(ArkBaseModel_1.ModifierType.PROTECTED) &&
            !this.getDeclaringArkClass().isDefaultArkClass() &&
            !this.isGenerated() &&
            !this.isAnonymousMethod() &&
            this.getName() !== TSConst_1.CONSTRUCTOR_NAME &&
            this.getDeclaringArkClass().getCategory() === ArkClass_1.ClassCategory.CLASS) {
            return true;
        }
        return this.containsModifier(ArkBaseModel_1.ModifierType.PUBLIC);
    }
}
exports.ArkMethod = ArkMethod;
//# sourceMappingURL=ArkMethod.js.map