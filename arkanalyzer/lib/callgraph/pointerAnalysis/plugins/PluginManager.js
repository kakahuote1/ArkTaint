"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
exports.PluginManager = void 0;
const ContainerPlugin_1 = require("./ContainerPlugin");
const FunctionPlugin_1 = require("./FunctionPlugin");
const SdkPlugin_1 = require("./SdkPlugin");
const StoragePlugin_1 = require("./StoragePlugin");
const TaskPoolPlugin_1 = require("./TaskPoolPlugin");
const WorkerPlugin_1 = require("./WorkerPlugin");
// plugins/PluginManager.ts
class PluginManager {
    constructor(pag, pagBuilder, cg) {
        this.plugins = [];
        this.init(pag, pagBuilder, cg);
    }
    init(pag, pagBuilder, cg) {
        this.registerPlugin(new StoragePlugin_1.StoragePlugin(pag, pagBuilder, cg));
        this.registerPlugin(new FunctionPlugin_1.FunctionPlugin(pag, pagBuilder, cg));
        this.registerPlugin(new TaskPoolPlugin_1.TaskPoolPlugin(pag, pagBuilder, cg));
        this.registerPlugin(new WorkerPlugin_1.WorkerPlugin(pag, pagBuilder, cg));
        this.registerPlugin(new SdkPlugin_1.SdkPlugin(pag, pagBuilder, cg));
        this.registerPlugin(new ContainerPlugin_1.ContainerPlugin(pag, pagBuilder, cg));
    }
    registerPlugin(plugin) {
        this.plugins.push(plugin);
    }
    findPlugin(cs, cgNode) {
        return this.plugins.find(plugin => plugin.canHandle(cs, cgNode));
    }
    getAllPlugins() {
        return this.plugins;
    }
    processCallSite(cs, cid, basePTNode, cg) {
        const cgNode = cg.getNode(cs.getCalleeFuncID());
        const plugin = this.findPlugin(cs, cgNode);
        let srcNodes = [];
        if (plugin) {
            srcNodes.push(...plugin.processCallSite(cs, cid, basePTNode));
            return { handled: true, srcNodes: srcNodes };
        }
        return { handled: false, srcNodes: srcNodes };
    }
    // sdk plugin interfaces
    processSDKFuncPag(funcID, method) {
        const plugin = this.plugins.find(p => p.getName() === 'SdkPlugin');
        if (plugin) {
            plugin.buildSDKFuncPag(funcID, method);
            return { handled: true };
        }
        return { handled: false };
    }
    getSDKParamValue(method) {
        return this.plugins.find(p => p.getName() === 'SdkPlugin').getParamValues(method);
    }
    // taskpool plugin interfaces
    getTaskObj2CGNodeMap() {
        return this.plugins.find(p => p.getName() === 'TaskPoolPlugin').getTaskObj2CGNodeMap();
    }
    getTaskObj2ConstructorStmtMap() {
        return this.plugins.find(p => p.getName() === 'TaskPoolPlugin').getTaskObj2ConstructorStmtMap();
    }
    // worker plugin interfaces
    getWorkerObj2CGNodeMap() {
        return this.plugins.find(p => p.getName() === 'WorkerPlugin').getWorkerObj2CGNodeMap();
    }
}
exports.PluginManager = PluginManager;
