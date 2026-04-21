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
exports.RefUseReplacer = void 0;
const Local_1 = require("../base/Local");
const Ref_1 = require("../base/Ref");
/**
 * Replace old use of a Ref inplace
 */
class RefUseReplacer {
    constructor(oldUse, newUse) {
        this.oldUse = oldUse;
        this.newUse = newUse;
    }
    caseRef(ref) {
        if (ref instanceof Ref_1.ArkInstanceFieldRef) {
            this.caseFieldRef(ref);
        }
        else if (ref instanceof Ref_1.ArkArrayRef) {
            this.caseArrayRef(ref);
        }
    }
    caseFieldRef(ref) {
        if (ref.getBase() === this.oldUse && this.newUse instanceof Local_1.Local) {
            ref.setBase(this.newUse);
        }
    }
    caseArrayRef(ref) {
        if (ref.getBase() === this.oldUse) {
            if (this.newUse instanceof Local_1.Local) {
                ref.setBase(this.newUse);
            }
        }
        else if (ref.getIndex() === this.oldUse) {
            ref.setIndex(this.newUse);
        }
    }
}
exports.RefUseReplacer = RefUseReplacer;
