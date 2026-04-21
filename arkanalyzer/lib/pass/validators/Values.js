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
exports.LocalValidator = void 0;
const Validator_1 = require("./Validator");
const Local_1 = require("../../core/base/Local");
const Const_1 = require("../../core/common/Const");
class LocalValidator extends Validator_1.ValueValidator {
    validate(value, ctx) {
        if (value.getName().startsWith(Const_1.NAME_PREFIX) && !value.getDeclaringStmt()) {
            ctx.info(`should have declaring stmt`);
        }
    }
}
exports.LocalValidator = LocalValidator;
LocalValidator.INSTANCE = new LocalValidator();
(() => {
    LocalValidator.register([Local_1.Local, (v, ctx, mtd) => {
            LocalValidator.INSTANCE.run(v, ctx, mtd);
        }]);
})();
