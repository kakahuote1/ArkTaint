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
exports.DummyCallCreator = void 0;
const Expr_1 = require("../../core/base/Expr");
const Stmt_1 = require("../../core/base/Stmt");
const entryMethodUtils_1 = require("../../utils/entryMethodUtils");
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Dummy Call');
/**
 * TODO: constructor pointer and cid
 */
class DummyCallCreator {
    constructor(scene) {
        this.scene = scene;
        this.componentMap = new Map();
        this.pageMap = new Map();
    }
    getDummyCallByPage(classSig, basePage) {
        let dummyCallStmts = this.pageMap.get(classSig);
        if (dummyCallStmts) {
            return dummyCallStmts;
        }
        dummyCallStmts = this.buildDummyCallBody(classSig, basePage);
        this.pageMap.set(classSig, dummyCallStmts);
        return dummyCallStmts;
    }
    getDummyCallByComponent(classSig, baseComponent) {
        let dummyCallStmts = this.componentMap.get(classSig);
        if (dummyCallStmts) {
            return dummyCallStmts;
        }
        dummyCallStmts = this.buildDummyCallBody(classSig, baseComponent);
        this.componentMap.set(classSig, dummyCallStmts);
        return dummyCallStmts;
    }
    /**
     * build dummy call edge with class signature, including a class new expr and call back function invokes
     * @param classSig class signature
     * @returns dummy call edges
     */
    buildDummyCallBody(classSig, baseComponent) {
        let dummyCallStmts = new Set();
        this.getComponentCallStmts(classSig, baseComponent).forEach(stmt => dummyCallStmts.add(stmt));
        return dummyCallStmts;
    }
    getComponentCallStmts(classSig, base) {
        let componentClass = this.scene.getClass(classSig);
        if (!componentClass) {
            logger.error(`can not find class ${classSig.toString()}`);
            return [];
        }
        let callStmts = [];
        // filter callback method
        componentClass
            .getMethods()
            .filter(method => entryMethodUtils_1.COMPONENT_LIFECYCLE_METHOD_NAME.includes(method.getName()))
            .forEach((method) => {
            // TODO: args pointer ?
            if (method.getParameters().length === 0) {
                callStmts.push(new Stmt_1.ArkInvokeStmt(new Expr_1.ArkInstanceInvokeExpr(base, method.getSignature(), [])));
            }
            else {
                logger.warn(`parameters in callback function hasn't been processed: ${method.getSignature().toString()}`);
            }
        });
        return callStmts;
    }
}
exports.DummyCallCreator = DummyCallCreator;
