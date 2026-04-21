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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkBody = void 0;
const ArkSignature_1 = require("./ArkSignature");
class ArkBody {
    constructor(locals, cfg, aliasTypeMap, traps) {
        this.cfg = cfg;
        this.aliasTypeMap = aliasTypeMap;
        this.locals = new Map();
        locals.forEach(local => this.locals.set(local.getName(), local));
        this.traps = traps;
    }
    getLocals() {
        return this.locals;
    }
    setLocals(locals) {
        this.locals.clear();
        locals.forEach(local => this.locals.set(local.getName(), local));
    }
    addLocal(name, local) {
        this.locals.set(name, local);
    }
    getUsedGlobals() {
        return this.usedGlobals;
    }
    setUsedGlobals(globals) {
        this.usedGlobals = globals;
    }
    getCfg() {
        return this.cfg;
    }
    setCfg(cfg) {
        this.cfg = cfg;
    }
    getAliasTypeMap() {
        return this.aliasTypeMap;
    }
    getAliasTypeByName(name) {
        const aliasTypeInfo = this.aliasTypeMap?.get(name);
        if (aliasTypeInfo) {
            return aliasTypeInfo[0];
        }
        return null;
    }
    getTraps() {
        return this.traps;
    }
    getExportLocalByName(name) {
        const local = this.locals?.get(name);
        if (local) {
            local.setSignature(new ArkSignature_1.LocalSignature(name, this.cfg.getDeclaringMethod().getSignature()));
            return local;
        }
        return null;
    }
}
exports.ArkBody = ArkBody;
//# sourceMappingURL=ArkBody.js.map