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
exports.ScenePassMgr = exports.SceneCtx = void 0;
const Context_1 = require("./Context");
const logger_1 = __importStar(require("../utils/logger"));
const Dispatcher_1 = require("./Dispatcher");
const Pass_1 = require("./Pass");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SceneMgr');
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The SceneCtx is bound to a UpperRoot and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx itself.
 */
class SceneCtx extends Context_1.Context {
    constructor() {
        super(Context_1.UpperRoot.getInstance());
    }
    root() {
        return this;
    }
}
exports.SceneCtx = SceneCtx;
class ScenePassMgr {
    constructor(props) {
        this.passes = {
            file: [],
            klass: [],
            method: [],
        };
        this.selectors = undefined;
        this.dispatcher = Dispatcher_1.Dispatcher;
        this.sctx = new SceneCtx();
        if (props.passes) {
            this.passes = props.passes;
        }
        if (props.selectors) {
            this.selectors = props.selectors;
        }
        if (props.dispatcher) {
            this.dispatcher = props.dispatcher;
        }
    }
    sceneContext() {
        return this.sctx;
    }
    run(scene) {
        var _a;
        logger.info('run scene');
        let files;
        if ((_a = this.selectors) === null || _a === void 0 ? void 0 : _a.file) {
            files = this.selectors.file(scene);
        }
        else {
            files = scene.getFiles();
        }
        for (let file of files) {
            this.iterFile(file);
        }
    }
    iterFile(file) {
        var _a;
        let fctx = new Pass_1.FileCtx(this.sctx);
        for (let P of this.passes.file) {
            let p = new P();
            if (p.run(file, fctx) === 1 /* FallAction.Break */) {
                break;
            }
        }
        let classes;
        if ((_a = this.selectors) === null || _a === void 0 ? void 0 : _a.klass) {
            classes = this.selectors.klass(file);
        }
        else {
            classes = file.getClasses();
        }
        for (let cls of classes) {
            this.iterClass(cls, fctx);
        }
    }
    iterClass(cls, fctx) {
        var _a;
        let cctx = new Pass_1.ClassCtx(fctx);
        for (let P of this.passes.klass) {
            let p = new P();
            if (p.run(cls, cctx) === 1 /* FallAction.Break */) {
                break;
            }
        }
        let methods;
        if ((_a = this.selectors) === null || _a === void 0 ? void 0 : _a.method) {
            methods = this.selectors.method(cls);
        }
        else {
            methods = cls.getMethods();
        }
        for (let mtd of methods) {
            this.iterMethod(mtd, cctx);
        }
    }
    iterMethod(mtd, cctx) {
        var _a;
        let mctx = new Pass_1.MethodCtx(cctx);
        for (let P of this.passes.method) {
            let p = new P();
            if (p.run(mtd, mctx) === 1 /* FallAction.Break */) {
                break;
            }
        }
        if (this.dispatcher) {
            let stmts = ((_a = mtd.getCfg()) === null || _a === void 0 ? void 0 : _a.getStmts()) || [];
            let dispatcher = new this.dispatcher(mctx);
            for (let s of stmts) {
                dispatcher.dispatchStmt(mtd, s);
            }
        }
    }
}
exports.ScenePassMgr = ScenePassMgr;
