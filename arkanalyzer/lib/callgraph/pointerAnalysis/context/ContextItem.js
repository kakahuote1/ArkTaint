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
exports.ContextItemManager = exports.FuncContextItem = exports.ObjectContextItem = exports.CallSiteContextItem = void 0;
class CallSiteContextItem {
    constructor(id, callSiteId, calleeFuncId) {
        this.id = id;
        this.callSiteId = callSiteId;
        this.calleeFuncId = calleeFuncId;
    }
    getSignature() {
        return `CS:${this.callSiteId}-${this.calleeFuncId}`;
    }
}
exports.CallSiteContextItem = CallSiteContextItem;
class ObjectContextItem {
    constructor(id, allocationSiteId) {
        this.id = id;
        this.nodeID = allocationSiteId;
    }
    getSignature() {
        return `OBJ:${this.nodeID}`;
    }
}
exports.ObjectContextItem = ObjectContextItem;
class FuncContextItem {
    constructor(id, funcID) {
        this.id = id;
        this.funcID = funcID;
    }
    getSignature() {
        return `FUNC:${this.funcID}`;
    }
}
exports.FuncContextItem = FuncContextItem;
/**
 * Manages the creation and unique identification of all ContextItems.
 * This ensures that each unique item (based on its signature) has one and only one ID.
 */
class ContextItemManager {
    constructor() {
        this.itemToIdMap = new Map();
        this.idToItemMap = new Map();
        this.nextItemId = 0;
    }
    getOrCreateCallSiteItem(callSiteId, calleeFuncID) {
        const signature = `CS:${callSiteId}-${calleeFuncID}`;
        if (this.itemToIdMap.has(signature)) {
            const id = this.itemToIdMap.get(signature);
            return this.idToItemMap.get(id);
        }
        const id = this.nextItemId++;
        const item = new CallSiteContextItem(id, callSiteId, calleeFuncID);
        this.itemToIdMap.set(signature, id);
        this.idToItemMap.set(id, item);
        return item;
    }
    getOrCreateObjectItem(allocationSiteId) {
        const signature = `OBJ:${allocationSiteId}`;
        if (this.itemToIdMap.has(signature)) {
            const id = this.itemToIdMap.get(signature);
            return this.idToItemMap.get(id);
        }
        const id = this.nextItemId++;
        const item = new ObjectContextItem(id, allocationSiteId);
        this.itemToIdMap.set(signature, id);
        this.idToItemMap.set(id, item);
        return item;
    }
    getOrCreateFuncItem(calleeFuncID) {
        const signature = `FUNC:${calleeFuncID}`;
        if (this.itemToIdMap.has(signature)) {
            const id = this.itemToIdMap.get(signature);
            return this.idToItemMap.get(id);
        }
        const id = this.nextItemId++;
        const item = new FuncContextItem(id, calleeFuncID);
        this.itemToIdMap.set(signature, id);
        this.idToItemMap.set(id, item);
        return item;
    }
    getItem(id) {
        return this.idToItemMap.get(id);
    }
}
exports.ContextItemManager = ContextItemManager;
