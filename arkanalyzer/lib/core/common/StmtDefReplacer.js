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
exports.StmtDefReplacer = void 0;
const Stmt_1 = require("../base/Stmt");
const IRUtils_1 = require("./IRUtils");
/**
 * Replace old def(Value) of a Stmt inplace
 */
class StmtDefReplacer {
    constructor(oldDef, newDef) {
        this.oldDef = oldDef;
        this.newDef = newDef;
    }
    caseStmt(stmt) {
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            this.caseAssignStmt(stmt);
        }
    }
    caseAssignStmt(stmt) {
        const lValue = stmt.getLeftOp();
        if (lValue === this.oldDef) {
            IRUtils_1.IRUtils.adjustOperandOriginalPositions(stmt, this.oldDef, this.newDef);
            stmt.setLeftOp(this.newDef);
        }
    }
}
exports.StmtDefReplacer = StmtDefReplacer;
