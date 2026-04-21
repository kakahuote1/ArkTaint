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
exports.ContextCache = exports.FuncContext = exports.ObjContext = exports.CallSiteContext = exports.Context = exports.CONTAINER_ELEMENT_CID = exports.DUMMY_CID = void 0;
exports.DUMMY_CID = 0;
// Special context ID for container element/field nodes
// These nodes should be shared across all contexts for the same container object (identified by basePt)
// but should NOT be shared between different container objects (even with same cid=0)
exports.CONTAINER_ELEMENT_CID = -2;
/**
 * An abstract base class representing a context in pointer analysis.
 * A context is an immutable sequence of context elements (represented by their IDs).
 */
class Context {
    constructor(contextElems = []) {
        this.contextElems = contextElems;
    }
    // -------------------------------------------------------------------
    // Static Factory Methods
    // -------------------------------------------------------------------
    /**
     * Creates a new empty context instance.
     * This static method must be called on a concrete subclass.
     * @example CallSiteContext.newEmpty()
     */
    static newEmpty() {
        return new this();
    }
    /**
     * Creates a new context instance from an array of element IDs.
     * This static method must be called on a concrete subclass.
     * @param contextElems An array of ContextItem IDs.
     * @example CallSiteContext.new([1, 2])
     */
    static new(contextElems) {
        return new this(contextElems);
    }
    /**
     * Creates a new k-limited context by prepending a new element to an old context.
     * The returned instance has the same type as the `oldCtx`.
     * @param oldCtx The previous context instance.
     * @param elem The ID of the new element to add.
     * @param k The maximum length limit for the context.
     */
    static newKLimitedContext(oldCtx, elem, k) {
        let elems = [];
        if (k > 0) {
            elems.push(elem);
            const oldElems = oldCtx.contextElems;
            if (oldElems.length < k) {
                elems = elems.concat(oldElems);
            }
            else {
                elems = elems.concat(oldElems.slice(0, k - 1));
            }
        }
        // Use the constructor of the old context to create a new instance, preserving type
        const constructor = oldCtx.constructor;
        return new constructor(elems);
    }
    /**
     * Truncates an existing context to a specified k-limit.
     * The returned instance has the same type as `ctx`.
     * @param ctx The context instance to truncate.
     * @param k The maximum length limit for the context.
     */
    static kLimitedContext(ctx, k) {
        const constructor = ctx.constructor;
        if (ctx.length() <= k) {
            return new constructor(ctx.contextElems);
        }
        else {
            const elems = ctx.contextElems.slice(0, k);
            return new constructor(elems);
        }
    }
    // -------------------------------------------------------------------
    // Instance Methods
    // -------------------------------------------------------------------
    length() {
        return this.contextElems.length;
    }
    get(index) {
        if (index < 0 || index >= this.contextElems.length) {
            throw new Error('Index out of bounds');
        }
        return this.contextElems[index];
    }
    toString() {
        return this.contextElems.join('-');
    }
}
exports.Context = Context;
class CallSiteContext extends Context {
    append(callSiteID, calleeFunc, k, m) {
        let contextItem = m.getOrCreateCallSiteItem(callSiteID, calleeFunc);
        return Context.newKLimitedContext(this, contextItem.id, k);
    }
    dump(m, cg) {
        let content = '';
        for (let i = 0; i < this.length(); i++) {
            const item = m.getItem(this.get(i));
            const callSiteInfo = cg.getCallSiteInfo(item.callSiteId);
            content += `\t[${callSiteInfo}]\n`;
        }
        return content;
    }
}
exports.CallSiteContext = CallSiteContext;
class ObjContext extends Context {
    append(callSiteID, objId, k, m) {
        let contextItem = m.getOrCreateObjectItem(objId);
        return Context.newKLimitedContext(this, contextItem.id, k);
    }
    dump(m, cg) {
        let content = '';
        return content;
    }
}
exports.ObjContext = ObjContext;
class FuncContext extends Context {
    append(callSiteID, funcId, k, m) {
        let contextItem = m.getOrCreateFuncItem(funcId);
        return Context.newKLimitedContext(this, contextItem.id, k);
    }
    dump(m, cg) {
        let content = '';
        for (let i = 0; i < this.length(); i++) {
            const item = m.getItem(this.get(i));
            const methodSig = cg.getMethodByFuncID(item.funcID).toString();
            content += `\t[${methodSig}]\n`;
        }
        return content;
    }
}
exports.FuncContext = FuncContext;
class ContextCache {
    constructor() {
        this.contextList = [];
        this.contextToIDMap = new Map();
        this.contextList = [];
        this.contextToIDMap = new Map();
    }
    getOrNewContextID(context) {
        let cStr = context.toString();
        if (this.contextToIDMap.has(cStr)) {
            return this.contextToIDMap.get(cStr);
        }
        else {
            // real cid start from 1
            const id = this.contextList.length;
            this.contextList.push(context);
            this.contextToIDMap.set(cStr, id);
            return id;
        }
    }
    updateContext(id, newContext, oldContext) {
        if (this.contextList.length < id) {
            return false;
        }
        this.contextList[id] = newContext;
        let oldCStr = oldContext.toString();
        let newCStr = newContext.toString();
        this.contextToIDMap.delete(oldCStr);
        this.contextToIDMap.set(newCStr, id);
        return true;
    }
    getContextID(context) {
        let cStr = context.toString();
        if (this.contextToIDMap.has(cStr)) {
            return this.contextToIDMap.get(cStr);
        }
        return undefined;
    }
    getContext(id) {
        if (id > this.contextList.length) {
            return undefined;
        }
        return this.contextList[id];
    }
    getContextList() {
        return this.contextList;
    }
    dump(m, cg) {
        let content = '';
        this.contextList.forEach((c, i) => {
            content += `Context ${i}:\n`;
            content += `${c.dump(m, cg)}\n`;
        });
        return content;
    }
}
exports.ContextCache = ContextCache;
//# sourceMappingURL=Context.js.map