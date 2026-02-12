"use strict";
/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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
exports.StmtInference = exports.MethodInference = exports.ClassInference = exports.FileInference = exports.ImportInfoInference = void 0;
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const Stmt_1 = require("../base/Stmt");
const Inference_1 = require("./Inference");
const logger_1 = __importStar(require("../../utils/logger"));
const ArkSignature_1 = require("../model/ArkSignature");
const ModelUtils_1 = require("../common/ModelUtils");
const Type_1 = require("../base/Type");
const TypeInference_1 = require("../common/TypeInference");
const Ref_1 = require("../base/Ref");
const TSConst_1 = require("../common/TSConst");
const SdkUtils_1 = require("../common/SdkUtils");
const IRInference_1 = require("../common/IRInference");
const Local_1 = require("../base/Local");
const Const_1 = require("../common/Const");
const TypeExpr_1 = require("../base/TypeExpr");
const Expr_1 = require("../base/Expr");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ModelInference');
/**
 * Abstract base class for performing inference on ArkModel instances
 * Implements both Inference and InferenceFlow interfaces to provide
 * a complete inference workflow with pre/post processing capabilities
 */
class ArkModelInference {
    /**
     * Executes the complete inference workflow with error handling
     * @param model - The ArkModel instance to process
     * @returns Inference result or undefined if an error occurs
     */
    doInfer(model) {
        try {
            this.preInfer(model);
            const result = this.infer(model);
            return this.postInfer(model, result);
        }
        catch (error) {
            logger.warn('infer model failed:' + error.message);
        }
        return undefined;
    }
    /**
     * Pre-inference hook method for setup and preparation
     * Can be overridden by subclasses to add custom pre-processing logic
     * @param model - The ArkModel instance being processed
     */
    preInfer(model) {
    }
    /**
     * Post-inference hook method for cleanup and finalization
     * Can be overridden by subclasses to add custom post-processing logic
     * @param model - The ArkModel instance that was processed
     * @param result
     */
    postInfer(model, result) {
    }
}
class ImportInfoInference extends ArkModelInference {
    constructor() {
        super(...arguments);
        this.fromFile = null;
    }
    /**
     * find export from file
     * @param fromInfo
     */
    infer(fromInfo) {
        const file = this.fromFile;
        if (!file) {
            logger.warn(`${fromInfo.getOriginName()} ${fromInfo.getFrom()} file not found: ${fromInfo.getDeclaringArkFile()?.getFileSignature()?.toString()}`);
            return null;
        }
        if ((0, ArkSignature_1.fileSignatureCompare)(file.getFileSignature(), fromInfo.getDeclaringArkFile().getFileSignature())) {
            for (let exportInfo of file.getExportInfos()) {
                if (exportInfo.getOriginName() === fromInfo.getOriginName()) {
                    exportInfo.setArkExport(file.getDefaultClass());
                    return exportInfo;
                }
            }
            return null;
        }
        let exportInfo = (0, ModelUtils_1.findExportInfoInfile)(fromInfo, file) || null;
        if (exportInfo === null) {
            logger.warn('export info not found, ' + fromInfo.getFrom() + ' in file: ' + fromInfo.getDeclaringArkFile().getFileSignature().toString());
            return null;
        }
        const arkExport = (0, ModelUtils_1.findArkExport)(exportInfo);
        exportInfo.setArkExport(arkExport);
        if (arkExport) {
            exportInfo.setExportClauseType(arkExport.getExportType());
        }
        return exportInfo;
    }
    /**
     * cleanup fromFile and set exportInfo
     * @param fromInfo
     * @param exportInfo
     */
    postInfer(fromInfo, exportInfo) {
        if (exportInfo) {
            fromInfo.setExportInfo(exportInfo);
        }
        this.fromFile = null;
    }
}
exports.ImportInfoInference = ImportInfoInference;
class FileInference extends ArkModelInference {
    constructor(importInfoInference, classInference) {
        super();
        this.importInfoInference = importInfoInference;
        this.classInference = classInference;
    }
    getClassInference() {
        return this.classInference;
    }
    /**
     * Pre-inference phase - processes unresolved import information in the file
     * @param {ArkFile} file
     */
    preInfer(file) {
        file.getImportInfos().filter(i => i.getExportInfo() === undefined)
            .forEach(info => this.importInfoInference.doInfer(info));
    }
    /**
     * Main inference phase - processes all arkClass definitions in the file
     * @param {ArkFile} file
     */
    infer(file) {
        ModelUtils_1.ModelUtils.getAllClassesInFile(file).forEach(arkClass => this.classInference.doInfer(arkClass));
    }
    /**
     * Post-inference phase - processes export information for the file
     * @param {ArkFile} file
     */
    postInfer(file) {
        IRInference_1.IRInference.inferExportInfos(file);
    }
}
exports.FileInference = FileInference;
class ClassInference extends ArkModelInference {
    constructor(methodInference) {
        super();
        this.methodInference = methodInference;
    }
    getMethodInference() {
        return this.methodInference;
    }
    /**
     * Pre-inference phase - processes heritage class information for the class
     * @param {ArkClass} arkClass
     */
    preInfer(arkClass) {
        arkClass.getAllHeritageClasses();
    }
    /**
     * Main inference phase - processes all methods in the class
     * @param {ArkClass} arkClass
     */
    infer(arkClass) {
        arkClass.getMethods(true).forEach(method => {
            this.methodInference.doInfer(method);
        });
    }
}
exports.ClassInference = ClassInference;
class MethodInference extends ArkModelInference {
    constructor(stmtInference) {
        super();
        this.stmtInference = stmtInference;
    }
    /**
     * Marks a method as visited to prevent infinite recursion
     * @param {ArkMethod} method - The method to mark as visited
     */
    markVisited(method) {
        if (!this.callBackVisited) {
            this.callBackVisited = new Set();
        }
        this.callBackVisited.add(method);
    }
    /**
     * Clears the visited methods set
     */
    cleanVisited() {
        this.callBackVisited = undefined;
    }
    /**
     * Main inference phase - processes all statements in the method body
     * @param {ArkMethod} method - The method to analyze
     * @returns {InferStmtResult[]} Array of modified or impacted statements during inference
     */
    infer(method) {
        const modifiedStmts = [];
        // timeout
        const startTime = Date.now();
        // Check for cycle prevention
        if (this.callBackVisited) {
            if (this.callBackVisited.has(method)) {
                return modifiedStmts;
            }
            else {
                this.callBackVisited.add(method);
            }
        }
        const body = method.getBody();
        if (!body) {
            return modifiedStmts;
        }
        // Process used globals
        body.getUsedGlobals()?.forEach((value, key) => {
            if (value instanceof Ref_1.GlobalRef && !value.getRef()) {
                const global = ModelUtils_1.ModelUtils.findGlobalRef(key, method);
                if (global instanceof Local_1.Local) {
                    const set = new Set(global.getUsedStmts());
                    value.getUsedStmts().filter(f => !set.has(f)).forEach(stmt => global.addUsedStmt(stmt));
                    value.setRef(global);
                }
            }
        });
        const workList = new Set(body.getCfg().getStmts());
        for (let stmt of workList) {
            if (Date.now() - startTime > MethodInference.TIMEOUT_MS) {
                logger.error(`Inference timeout for method: ${method.getName()}`);
                return modifiedStmts;
            }
            const result = this.stmtInference.doInfer(stmt);
            if (!result) {
                continue;
            }
            const inferResult = result;
            // collect modified Stmts to update CFG
            if (inferResult.replacedStmts) {
                modifiedStmts.push(inferResult);
            }
            // Add impacted statements to work list
            inferResult.impactedStmts?.filter(s => !workList.has(s)).forEach(e => workList.add(e));
            workList.delete(stmt);
        }
        return modifiedStmts;
    }
    /**
     * Post-inference phase - updates CFG and infers return type
     * @param {ArkMethod} method - The method that was analyzed
     * @param {InferStmtResult[]} modifiedStmts - Modified statements from inference phase
     */
    postInfer(method, modifiedStmts) {
        // Update CFG
        const cfg = method.getCfg();
        if (modifiedStmts.length > 0 && cfg) {
            modifiedStmts.forEach(m => {
                cfg.insertAfter(m.replacedStmts, m.oldStmt);
                cfg.remove(m.oldStmt);
            });
        }
        //infers return type
        if (!method.getBody() || method.getName() === TSConst_1.CONSTRUCTOR_NAME ||
            !TypeInference_1.TypeInference.isUnclearType(method.getImplementationSignature()?.getMethodSubSignature().getReturnType())) {
            return;
        }
        const returnType = TypeInference_1.TypeInference.inferReturnType(method);
        if (returnType) {
            method.getImplementationSignature()?.getMethodSubSignature().setReturnType(returnType);
        }
    }
}
exports.MethodInference = MethodInference;
MethodInference.TIMEOUT_MS = 3000;
class StmtInference extends ArkModelInference {
    constructor(valueInferences) {
        super();
        this.valueInferences = new Map();
        valueInferences.forEach(v => this.valueInferences.set(v.getValueName(), v));
    }
    /**
     * Main inference phase - processes a statement and its associated values
     * @param {Stmt} stmt - The statement to analyze
     * @returns {Type | undefined} The original definition type before inference
     */
    infer(stmt) {
        const defType = stmt.getDef()?.getType();
        stmt.getDefAndUses().forEach(value => this.inferValue(value, stmt));
        return defType;
    }
    /**
     * Post-inference phase - handles type propagation and impact analysis
     * @param {Stmt} stmt - The statement that was analyzed
     * @param {Type | undefined} defType - The original definition type before inference
     * @returns {InferStmtResult | undefined} Inference result with impacted statements
     */
    postInfer(stmt, defType) {
        const method = stmt.getCfg().getDeclaringMethod();
        let replacedStmts = [];
        let impactedStmts = new Set();
        if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getLeftOp() instanceof Expr_1.AbstractInvokeExpr) {
            const invokeExpr = stmt.getLeftOp();
            const cls = method.getDeclaringArkFile().getScene().getClass(invokeExpr.getMethodSignature().getDeclaringClassSignature());
            const name = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName().replace(Const_1.GETTER_PREFIX, Const_1.SETTER_PREFIX);
            const invokeMethod = cls?.getMethodWithName(name) ?? cls?.getStaticMethodWithName(name);
            if (invokeMethod) {
                invokeExpr.setMethodSignature(invokeMethod.getSignature());
            }
            invokeExpr.setArgs([stmt.getRightOp()]);
            replacedStmts.push(new Stmt_1.ArkInvokeStmt(invokeExpr));
        }
        else {
            impactedStmts = this.typeSpread(stmt, method);
        }
        const finalDef = stmt.getDef();
        if (defType !== finalDef?.getType() && finalDef instanceof Local_1.Local &&
            (method.getBody()?.getUsedGlobals()?.get(finalDef.getName()) || !finalDef.getName().startsWith(Const_1.NAME_PREFIX))) {
            finalDef.getUsedStmts().forEach(e => impactedStmts.add(e));
        }
        return {
            oldStmt: stmt,
            impactedStmts: impactedStmts.size > 0 ? Array.from(impactedStmts) : undefined,
            replacedStmts: replacedStmts.length > 0 ? replacedStmts : undefined
        };
    }
    /**
     * Recursively infers types for values and their dependencies
     * @param {Value} value - The value to infer
     * @param {Stmt} stmt - The containing statement
     * @param {Set<Value>} visited - Set of already visited values for cycle prevention
     */
    inferValue(value, stmt, visited = new Set()) {
        if (visited.has(value)) {
            return;
        }
        else {
            visited.add(value);
        }
        const name = value.constructor.name;
        const valueInference = this.valueInferences.get(name);
        if (!valueInference) {
            logger.debug(name + ' valueInference not found');
            return;
        }
        const type = value.getType();
        if (type instanceof TypeExpr_1.AbstractTypeExpr) {
            type.getUses().forEach(sub => this.inferValue(sub, stmt, visited));
        }
        value.getUses().forEach(sub => this.inferValue(sub, stmt, visited));
        valueInference.doInfer(value, stmt);
    }
    /**
     * Propagates types through statements and handles special cases
     * @param {Stmt} stmt - The statement to process
     * @param {ArkMethod} method - The containing method
     * @returns {Set<Stmt>} Set of statements impacted by type propagation
     */
    typeSpread(stmt, method) {
        let impactedStmts;
        const invokeExpr = stmt.getInvokeExpr();
        // Handle method invocation parameter spreading
        if (invokeExpr) {
            impactedStmts = this.paramSpread(invokeExpr, method);
        }
        else {
            impactedStmts = new Set();
        }
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            this.transferTypeBidirectional(stmt, method, impactedStmts);
        }
        else if (stmt instanceof Stmt_1.ArkReturnStmt) {
            // Handle return statements with async type resolution
            let returnType = method.getSignature().getType();
            if (method.containsModifier(ArkBaseModel_1.ModifierType.ASYNC) && returnType instanceof Type_1.ClassType &&
                returnType.getClassSignature().getClassName() === TSConst_1.PROMISE) {
                const realGenericType = returnType.getRealGenericTypes()?.[0];
                if (realGenericType) {
                    returnType = realGenericType;
                }
            }
            IRInference_1.IRInference.inferRightWithSdkType(returnType, stmt.getOp().getType(), method.getDeclaringArkClass());
        }
        return impactedStmts;
    }
    /**
     * Transfers types bidirectionally in assignment statements
     * @param {ArkAssignStmt} stmt - The assignment statement
     * @param {ArkMethod} method - The containing method
     * @param {Set<Stmt>} impactedStmts - Set to collect impacted statements
     */
    transferTypeBidirectional(stmt, method, impactedStmts) {
        const rightType = stmt.getRightOp().getType();
        const leftOp = stmt.getLeftOp();
        let leftType = leftOp.getType();
        // Transfer type from left to right operand
        this.transferLeft2Right(stmt.getRightOp(), leftType, method)?.forEach(a => impactedStmts.add(a));
        // Transfer type from right to left operand
        this.transferRight2Left(leftOp, rightType, method)?.forEach(a => impactedStmts.add(a));
        // Handle global this references
        if (leftOp instanceof Ref_1.ArkStaticFieldRef) {
            const declaringSignature = leftOp.getFieldSignature().getDeclaringSignature();
            if (declaringSignature instanceof ArkSignature_1.NamespaceSignature && declaringSignature.getNamespaceName() === TSConst_1.GLOBAL_THIS_NAME) {
                SdkUtils_1.SdkUtils.computeGlobalThis(leftOp, method);
            }
        }
    }
    transferLeft2Right(rightOp, leftType, method) {
        const projectName = method.getDeclaringArkFile().getProjectName();
        // Skip if left type is unclear or anonymous
        if (TypeInference_1.TypeInference.isUnclearType(leftType) || TypeInference_1.TypeInference.isAnonType(leftType, projectName)) {
            return undefined;
        }
        const rightType = rightOp.getType();
        IRInference_1.IRInference.inferRightWithSdkType(leftType, rightType, method.getDeclaringArkClass());
        return this.updateValueType(rightOp, leftType, method);
    }
    transferRight2Left(leftOp, rightType, method) {
        if (TypeInference_1.TypeInference.isUnclearType(rightType)) {
            return undefined;
        }
        return this.updateValueType(leftOp, rightType, method);
    }
    /**
     * Updates the type of a target value and returns impacted statements
     * @param {Value} target - The target value to update
     * @param {Type} srcType - The source type to apply
     * @param {ArkMethod} method - The containing method
     * @returns {Stmt[] | undefined} Array of statements impacted by the type update
     */
    updateValueType(target, srcType, method) {
        const type = target.getType();
        if (type !== srcType && TypeInference_1.TypeInference.isUnclearType(type)) {
            if (target instanceof Local_1.Local) {
                target.setType(srcType);
                return target.getUsedStmts();
            }
            else if (target instanceof Ref_1.AbstractFieldRef) {
                target.getFieldSignature().setType(srcType);
            }
            else if (target instanceof Ref_1.ArkParameterRef) {
                target.setType(srcType);
            }
        }
        return undefined;
    }
    /**
     * Handles parameter type propagation for method invocations
     * @param {AbstractInvokeExpr} invokeExpr - The invocation expression
     * @param {ArkMethod} method - The containing method
     * @returns {Set<Stmt>} Set of statements impacted by parameter type propagation
     */
    paramSpread(invokeExpr, method) {
        const realTypes = [];
        const result = new Set();
        const len = invokeExpr.getArgs().length;
        const parameters = invokeExpr.getMethodSignature().getMethodSubSignature().getParameters()
            .filter(p => !p.getName().startsWith(Const_1.LEXICAL_ENV_NAME_PREFIX));
        // Map arguments to parameters
        for (let index = 0; index < len; index++) {
            const arg = invokeExpr.getArg(index);
            if (index >= parameters.length) {
                break;
            }
            const paramType = parameters[index].getType();
            this.mapArgWithParam(arg, paramType, invokeExpr, method, realTypes)?.forEach(a => result.add(a));
        }
        // Set real generic types for the invocation
        if (realTypes.length > 0 && !invokeExpr.getRealGenericTypes()) {
            invokeExpr.setRealGenericTypes(realTypes);
        }
        return result;
    }
    /**
     * Maps argument types to parameter types and handles callback inference
     */
    mapArgWithParam(arg, paramType, invokeExpr, method, realTypes) {
        const argType = arg.getType();
        const scene = method.getDeclaringArkFile().getScene();
        // Infer argument with parameter type
        IRInference_1.IRInference.inferArg(invokeExpr, argType, paramType, scene, realTypes);
        // Handle callback function inference
        if (argType instanceof Type_1.FunctionType) {
            const callback = scene.getMethod(argType.getMethodSignature());
            const paramLength = callback?.getImplementationSignature()?.getParamLength();
            // Infer callback method if it has parameters
            if (callback && paramLength && paramLength > 0) {
                const inference = Inference_1.InferenceManager.getInstance().getInference(callback.getDeclaringArkFile().getLanguage());
                if (inference instanceof FileInference) {
                    const methodInference = inference.getClassInference().getMethodInference();
                    methodInference.markVisited(method);
                    methodInference.doInfer(callback);
                    methodInference.cleanVisited();
                }
            }
            // Infer map function return type for generic resolution
            const returnType = argType.getMethodSignature().getMethodSubSignature().getReturnType();
            if (!TypeInference_1.TypeInference.isUnclearType(returnType) && !(returnType instanceof Type_1.VoidType) && paramType instanceof Type_1.FunctionType) {
                const declareReturnType = paramType.getMethodSignature().getMethodSubSignature().getReturnType();
                const realGenericTypes = invokeExpr.getRealGenericTypes();
                if (declareReturnType instanceof Type_1.GenericType && realGenericTypes && !realGenericTypes[declareReturnType.getIndex()]) {
                    realGenericTypes[declareReturnType.getIndex()] = returnType;
                }
            }
        }
        // Update argument type if parameter type is clear
        if (!TypeInference_1.TypeInference.isUnclearType(paramType) && !TypeInference_1.TypeInference.isAnonType(paramType, scene.getProjectName())) {
            return this.updateValueType(arg, paramType, method);
        }
        return undefined;
    }
}
exports.StmtInference = StmtInference;
//# sourceMappingURL=ModelInference.js.map