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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KFuncContextSelector = exports.KObjContextSelector = exports.KCallSiteContextSelector = exports.emptyID = void 0;
const Context_1 = require("./Context");
const ContextItem_1 = require("./ContextItem");
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
/**
 * Top layer of context
 */
exports.emptyID = -1;
class KCallSiteContextSelector {
    constructor(k) {
        this.k = k;
        this.ctxCache = new Context_1.ContextCache();
        this.ctxManager = new ContextItem_1.ContextItemManager();
    }
    selectContext(callerContextID, callSite, obj, callee) {
        let callerContext = this.ctxCache.getContext(callerContextID);
        let calleeFuncID = callSite.getCalleeFuncID();
        if (!callerContext || !calleeFuncID) {
            return Context_1.DUMMY_CID;
        }
        let calleeContext = callerContext.append(callSite.id, calleeFuncID, this.k, this.ctxManager);
        return this.ctxCache.getOrNewContextID(calleeContext);
    }
    emptyContext(id) {
        let emptyContext = Context_1.CallSiteContext.newEmpty();
        return this.ctxCache.getOrNewContextID(emptyContext);
    }
    getContextID(context) {
        return this.ctxCache.getOrNewContextID(context);
    }
    dump(dir, cg) {
        const content = this.ctxCache.dump(this.ctxManager, cg);
        const filePath = path_1.default.join(dir, 'context.txt');
        fs.writeFileSync(filePath, content, 'utf8');
    }
}
exports.KCallSiteContextSelector = KCallSiteContextSelector;
// WIP
class KObjContextSelector {
    constructor(k) {
        this.k = k;
        this.ctxCache = new Context_1.ContextCache();
        this.ctxManager = new ContextItem_1.ContextItemManager();
    }
    selectContext(callerContextID, callSite, obj, callee) {
        let callerContext = this.ctxCache.getContext(callerContextID);
        if (!callerContext) {
            return Context_1.DUMMY_CID;
        }
        if (obj === exports.emptyID) {
            return callerContextID;
        }
        let calleeContext = callerContext.append(0, obj, this.k, this.ctxManager);
        return this.ctxCache.getOrNewContextID(calleeContext);
    }
    emptyContext(id) {
        let emptyContext = Context_1.ObjContext.newEmpty();
        return this.ctxCache.getOrNewContextID(emptyContext);
    }
    getContextID(context) {
        return this.ctxCache.getOrNewContextID(context);
    }
    dump(dir, cg) { }
}
exports.KObjContextSelector = KObjContextSelector;
class KFuncContextSelector {
    constructor(k) {
        this.k = k;
        this.ctxCache = new Context_1.ContextCache();
        this.ctxManager = new ContextItem_1.ContextItemManager();
    }
    selectContext(callerContextID, callSite, obj, funcID) {
        let callerContext = this.ctxCache.getContext(callerContextID);
        if (!callerContext) {
            return Context_1.DUMMY_CID;
        }
        let calleeContext = callerContext.append(0, funcID, this.k, this.ctxManager);
        return this.ctxCache.getOrNewContextID(calleeContext);
    }
    emptyContext(funcID) {
        let emptyContext = Context_1.FuncContext.newEmpty();
        let calleeContext = emptyContext.append(0, funcID, this.k, this.ctxManager);
        return this.ctxCache.getOrNewContextID(calleeContext);
    }
    getContextID(context) {
        return this.ctxCache.getOrNewContextID(context);
    }
    dump(dir, cg) {
        const content = this.ctxCache.dump(this.ctxManager, cg);
        const filePath = path_1.default.join(dir, 'context.txt');
        fs.writeFileSync(filePath, content, 'utf8');
    }
}
exports.KFuncContextSelector = KFuncContextSelector;
//# sourceMappingURL=ContextSelector.js.map