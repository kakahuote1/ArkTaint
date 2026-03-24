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
exports.AbsInvokeValidator = void 0;
const Expr_1 = require("../../core/base/Expr");
const Validator_1 = require("./Validator");
const Constant_1 = require("../../core/base/Constant");
const Local_1 = require("../../core/base/Local");
class AbsInvokeValidator extends Validator_1.ValueValidator {
    validate(value, ctx) {
        value.getArgs().forEach((arg, i) => {
            this.checkArg(arg, i, ctx);
        });
    }
    checkArg(arg, index, ctx) {
        if (!((arg instanceof Local_1.Local) || (arg instanceof Constant_1.Constant))) {
            ctx.error(`arg ${index} is not local or constant`);
        }
    }
}
exports.AbsInvokeValidator = AbsInvokeValidator;
AbsInvokeValidator.INSTANCE = new AbsInvokeValidator();
(() => {
    AbsInvokeValidator.register([Expr_1.AbstractInvokeExpr, (v, ctx, mtd) => {
            AbsInvokeValidator.INSTANCE.run(v, ctx, mtd);
        }]);
})();
