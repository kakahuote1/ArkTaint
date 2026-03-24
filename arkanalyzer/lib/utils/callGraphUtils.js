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
exports.extractLastBracketContent = exports.printCallGraphDetails = exports.splitStringWithRegex = exports.isItemRegistered = exports.SceneManager = exports.MethodSignatureManager = void 0;
const logger_1 = __importStar(require("./logger"));
const ModelUtils_1 = require("../core/common/ModelUtils");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'callGraphUtils');
class MethodSignatureManager {
    constructor() {
        this._workList = [];
        this._processedList = [];
    }
    get workList() {
        return this._workList;
    }
    set workList(list) {
        this._workList = list;
    }
    get processedList() {
        return this._processedList;
    }
    set processedList(list) {
        this._processedList = list;
    }
    findInWorkList(signature) {
        return this.workList.find(item => item === signature);
    }
    findInProcessedList(signature) {
        let result = this.processedList.find(item => item.toString() === signature.toString());
        return typeof result !== 'undefined';
    }
    addToWorkList(signature) {
        if (!isItemRegistered(signature, this.workList, (a, b) => a.toString() === b.toString())) {
            this.workList.push(signature);
        }
    }
    addToProcessedList(signature) {
        if (!isItemRegistered(signature, this.processedList, (a, b) => a === b)) {
            this.processedList.push(signature);
        }
    }
    removeFromWorkList(signature) {
        this.workList = this.workList.filter(item => item !== signature);
    }
    removeFromProcessedList(signature) {
        this.processedList = this.processedList.filter(item => item.toString() !== signature.toString());
    }
}
exports.MethodSignatureManager = MethodSignatureManager;
class SceneManager {
    get scene() {
        return this._scene;
    }
    set scene(value) {
        this._scene = value;
    }
    getMethod(method) {
        let targetMethod = this._scene.getMethod(method);
        if (targetMethod != null) {
            return targetMethod;
        }
        // 支持SDK调用解析
        let file = this._scene.getFile(method.getDeclaringClassSignature().getDeclaringFileSignature());
        if (file) {
            const methods = ModelUtils_1.ModelUtils.getAllMethodsInFile(file);
            for (let methodUnderFile of methods) {
                if (method.toString() === methodUnderFile.getSignature().toString()) {
                    return methodUnderFile;
                }
            }
        }
        return targetMethod;
    }
    getClass(arkClass) {
        if (typeof arkClass.getClassName() === 'undefined') {
            return null;
        }
        let classInstance = this._scene.getClass(arkClass);
        if (classInstance != null) {
            return classInstance;
        }
        let sdkOrTargetProjectFile = this._scene.getFile(arkClass.getDeclaringFileSignature());
        // TODO: support get sdk class, targetProject class waiting to be supported
        if (sdkOrTargetProjectFile != null) {
            for (let classUnderFile of ModelUtils_1.ModelUtils.getAllClassesInFile(sdkOrTargetProjectFile)) {
                if (classUnderFile.getSignature().toString() === arkClass.toString()) {
                    return classUnderFile;
                }
            }
        }
        return classInstance;
    }
    getExtendedClasses(arkClass) {
        let sourceClass = this.getClass(arkClass);
        let classList = [sourceClass]; // 待处理类
        let extendedClasses = []; // 已经处理的类
        while (classList.length > 0) {
            let tempClass = classList.shift();
            if (tempClass == null) {
                continue;
            }
            let firstLevelSubclasses = Array.from(tempClass.getExtendedClasses().values());
            if (!firstLevelSubclasses) {
                continue;
            }
            for (let subclass of firstLevelSubclasses) {
                if (!isItemRegistered(subclass, extendedClasses, (a, b) => a.getSignature().toString() === b.getSignature().toString())) {
                    // 子类未处理，加入到classList
                    classList.push(subclass);
                }
            }
            // 当前类处理完毕，标记为已处理
            if (!isItemRegistered(tempClass, extendedClasses, (a, b) => a.getSignature().toString() === b.getSignature().toString())) {
                extendedClasses.push(tempClass);
            }
        }
        return extendedClasses;
    }
}
exports.SceneManager = SceneManager;
function isItemRegistered(item, array, compareFunc) {
    for (let tempItem of array) {
        if (compareFunc(tempItem, item)) {
            return true;
        }
    }
    return false;
}
exports.isItemRegistered = isItemRegistered;
function splitStringWithRegex(input) {
    // 正则表达式匹配 "a.b.c()" 并捕获 "a" "b" "c"
    const regex = /^(\w+)\.(\w+)\.(\w+)\(\)$/;
    const match = input.match(regex);
    if (match) {
        // 返回捕获的部分，忽略整个匹配结果
        return match.slice(1);
    }
    else {
        // 如果输入不匹配，返回空数组
        return [];
    }
}
exports.splitStringWithRegex = splitStringWithRegex;
function printCallGraphDetails(methods, calls, rootDir) {
    // 打印 Methods
    logger.info('Call Graph:\n');
    logger.info('\tMethods:');
    methods.forEach(method => {
        logger.info(`\t\t${method}`);
    });
    // 打印 Calls
    logger.info('\tCalls:');
    const arrow = '->';
    calls.forEach((calledMethods, method) => {
        // 对于每个调用源，只打印一次调用源和第一个目标方法
        const modifiedMethodName = `<${method}`;
        logger.info(`\t\t${modifiedMethodName.padEnd(4)}   ${arrow}`);
        for (let i = 0; i < calledMethods.length; i++) {
            const modifiedCalledMethod = `\t\t<${calledMethods[i]}`;
            logger.info(`\t\t${modifiedCalledMethod}`);
        }
        logger.info('\n');
    });
}
exports.printCallGraphDetails = printCallGraphDetails;
function extractLastBracketContent(input) {
    // 正则表达式匹配最后一个尖括号内的内容，直到遇到左圆括号
    const match = input.match(/<([^<>]*)\(\)>$/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return '';
}
exports.extractLastBracketContent = extractLastBracketContent;
