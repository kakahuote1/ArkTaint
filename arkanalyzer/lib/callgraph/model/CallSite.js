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
exports.CallSiteManager = exports.DynCallSite = exports.CallSite = void 0;
class CallSite {
    constructor(id, s, a, ce, cr) {
        this.id = id;
        this.callStmt = s;
        this.args = a;
        this.calleeFuncID = ce;
        this.callerFuncID = cr;
    }
    getCalleeFuncID() {
        return this.calleeFuncID;
    }
}
exports.CallSite = CallSite;
class DynCallSite {
    constructor(id, s, a, ptcCallee, caller) {
        this.id = id;
        this.callerFuncID = caller;
        this.callStmt = s;
        this.args = a;
        this.protentialCalleeFuncID = ptcCallee;
    }
    getCalleeFuncID() {
        return this.protentialCalleeFuncID;
    }
}
exports.DynCallSite = DynCallSite;
class CallSiteManager {
    constructor() {
        this.idToCallSiteMap = new Map();
        this.callSiteToIdMap = new Map();
        this.dynToStaticMap = new Map();
    }
    newCallSite(s, a, ce, cr) {
        let id = this.idToCallSiteMap.size;
        let callSite = new CallSite(id, s, a, ce, cr);
        this.idToCallSiteMap.set(id, callSite);
        this.callSiteToIdMap.set(callSite, id);
        return callSite;
    }
    newDynCallSite(s, a, ptcCallee, caller) {
        let id = this.idToCallSiteMap.size;
        let callSite = new DynCallSite(id, s, a, ptcCallee, caller);
        this.idToCallSiteMap.set(id, callSite);
        this.callSiteToIdMap.set(callSite, id);
        return callSite;
    }
    cloneCallSiteFromDyn(dynCallSite, calleeFuncID) {
        var _a;
        let clonedCS = (_a = this.dynToStaticMap.get(dynCallSite.id)) !== null && _a !== void 0 ? _a : [];
        let foundCS = clonedCS
            .map(id => this.idToCallSiteMap.get(id))
            .find(cs => cs.calleeFuncID === calleeFuncID);
        if (foundCS) {
            return foundCS;
        }
        let staticCS = this.newCallSite(dynCallSite.callStmt, dynCallSite.args, calleeFuncID, dynCallSite.callerFuncID);
        clonedCS.push(staticCS.id);
        this.dynToStaticMap.set(dynCallSite.id, clonedCS);
        return staticCS;
    }
    getCallSiteById(id) {
        return this.idToCallSiteMap.get(id);
    }
}
exports.CallSiteManager = CallSiteManager;
