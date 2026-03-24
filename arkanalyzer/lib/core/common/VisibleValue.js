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
exports.Scope = exports.VisibleValue = void 0;
const logger_1 = __importStar(require("../../utils/logger"));
const Local_1 = require("../base/Local");
const Ref_1 = require("../base/Ref");
const Stmt_1 = require("../base/Stmt");
const Type_1 = require("../base/Type");
const BasicBlock_1 = require("../graph/BasicBlock");
const ArkClass_1 = require("../model/ArkClass");
const ArkFile_1 = require("../model/ArkFile");
const ArkMethod_1 = require("../model/ArkMethod");
const ArkNamespace_1 = require("../model/ArkNamespace");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'VisibleValue');
class VisibleValue {
    constructor() {
        // TODO:填充全局变量
        this.currScope = new Scope([], 0);
        this.scopeChain = [this.currScope];
        this.currVisibleValues = [...this.currScope.values];
    }
    /** get values that is visible in curr scope */
    getCurrVisibleValues() {
        return this.currVisibleValues;
    }
    getScopeChain() {
        return this.scopeChain;
    }
    /** udpate visible values after entered a scope, only support step by step */
    updateIntoScope(model) {
        let name = '';
        if (model instanceof BasicBlock_1.BasicBlock) {
            name = 'block: ' + model.toString();
        }
        else {
            name = model.getName();
        }
        logger.info('---- into scope:{', name, '}');
        // get values in this scope
        let values = [];
        if (model instanceof ArkFile_1.ArkFile || model instanceof ArkNamespace_1.ArkNamespace) {
            values = this.getVisibleValuesIntoFileOrNameSpace(model);
        }
        else if (model instanceof ArkClass_1.ArkClass) {
            values = this.getVisibleValuesIntoClass(model);
        }
        else if (model instanceof ArkMethod_1.ArkMethod) {
            values = this.getVisibleValuesIntoMethod(model);
        }
        else if (model instanceof BasicBlock_1.BasicBlock) {
            values = this.getVisibleValuesIntoBasicBlock(model);
        }
        // handle scope chain
        const targetDepth = this.getTargetDepth(model);
        this.addScope(values, targetDepth, model);
    }
    /** udpate visible values after left a scope, only support step by step */
    updateOutScope() {
        const currModel = this.currScope.arkModel;
        let name = '';
        if (currModel instanceof BasicBlock_1.BasicBlock) {
            name = 'block: ' + currModel.toString();
        }
        else {
            name = currModel.getName();
        }
        logger.info('---- out scope:{', name, '}');
        let targetDepth = this.currScope.depth;
        if (currModel instanceof BasicBlock_1.BasicBlock) {
            const successorsCnt = currModel.getSuccessors().length;
            // if successorsCnt <= 0, unchange
            if (successorsCnt > 1) {
                targetDepth += 1; // goto inner scope
            }
        }
        this.deleteScope(targetDepth);
    }
    /** clear up previous scope */
    deleteScope(targetDepth) {
        const prevDepth = this.currScope.depth;
        if (targetDepth > prevDepth) {
            return;
        }
        let popScopeValuesCnt = 0;
        let popScopeCnt = 0;
        for (let i = this.scopeChain.length - 1; i >= 0; i--) {
            if (this.scopeChain[i].depth < targetDepth) {
                break;
            }
            popScopeCnt += 1;
            popScopeValuesCnt += this.scopeChain[i].values.length;
        }
        this.scopeChain.splice(this.scopeChain.length - popScopeCnt, popScopeCnt)[0]; // popScopeCnt >= 1
        this.currScope = this.scopeChain[this.scopeChain.length - 1];
        const totalValuesCnt = this.currVisibleValues.length;
        this.currVisibleValues.splice(totalValuesCnt - popScopeValuesCnt, popScopeValuesCnt);
    }
    /** add this scope to scope chain and update visible values */
    addScope(values, targetDepth, model) {
        const newScope = new Scope(values, targetDepth, model);
        this.currScope = newScope;
        this.scopeChain.push(this.currScope);
        this.currVisibleValues.push(...this.currScope.values);
    }
    // TODO:构造嵌套关系树
    getTargetDepth(model) {
        const prevDepth = this.currScope.depth;
        const prevModel = this.currScope.arkModel;
        let targetDepth = prevDepth + 1;
        if (model instanceof BasicBlock_1.BasicBlock) {
            const predecessorsCnt = model.getPredecessors().length;
            if (predecessorsCnt <= 1) {
                targetDepth = prevDepth + 1;
            }
            else {
                targetDepth = prevDepth;
            }
        }
        else if (model instanceof ArkFile_1.ArkFile && prevModel instanceof ArkFile_1.ArkFile) {
            targetDepth = prevDepth;
        }
        else if (model instanceof ArkNamespace_1.ArkNamespace && prevModel instanceof ArkNamespace_1.ArkNamespace) {
            targetDepth = prevDepth;
        }
        else if (model instanceof ArkClass_1.ArkClass && prevModel instanceof ArkClass_1.ArkClass) {
            targetDepth = prevDepth;
        }
        else if (model instanceof ArkMethod_1.ArkMethod && prevModel instanceof ArkMethod_1.ArkMethod) {
            targetDepth = prevDepth;
        }
        return targetDepth;
    }
    getVisibleValuesIntoFileOrNameSpace(fileOrNameSpace) {
        let values = [];
        return values;
    }
    getVisibleValuesIntoClass(cls) {
        const values = [];
        const fields = cls.getFields();
        const classSignature = cls.getSignature();
        for (const field of fields) {
            if (field.isStatic()) {
                const staticFieldRef = new Ref_1.ArkStaticFieldRef(field.getSignature());
                values.push(staticFieldRef);
            }
            else {
                const instanceFieldRef = new Ref_1.ArkInstanceFieldRef(new Local_1.Local('this', new Type_1.ClassType(classSignature)), field.getSignature());
                values.push(instanceFieldRef);
            }
        }
        return values;
    }
    getVisibleValuesIntoMethod(method) {
        let visibleValues = [];
        return visibleValues;
    }
    getVisibleValuesIntoBasicBlock(basiceBlock) {
        const visibleValues = [];
        for (const stmt of basiceBlock.getStmts()) {
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                visibleValues.push(stmt.getLeftOp());
            }
        }
        return visibleValues;
    }
}
exports.VisibleValue = VisibleValue;
class Scope {
    constructor(values, depth = -1, arkModel = null) {
        this.values = values;
        this.depth = depth;
        this.arkModel = arkModel;
    }
}
exports.Scope = Scope;
