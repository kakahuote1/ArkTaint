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
exports.ArkFileValidator = exports.ArkClassValidator = exports.ArkMethodValidator = void 0;
const Validator_1 = require("./Validator");
const ArkError_1 = require("../../core/common/ArkError");
class ArkMethodValidator extends Validator_1.MethodValidator {
    validate(mtd, ctx) {
        const err = mtd.validate();
        if (err.errCode !== ArkError_1.ArkErrorCode.OK) {
            ctx.error(`code: ${err.errCode} msg: ${err.errMsg}`);
        }
    }
}
exports.ArkMethodValidator = ArkMethodValidator;
class ArkClassValidator extends Validator_1.ClassValidator {
    validate(cls, ctx) {
        const err = cls.validate();
        if (err.errCode !== ArkError_1.ArkErrorCode.OK) {
            ctx.error(`code: ${err.errCode} msg: ${err.errMsg}`);
        }
    }
}
exports.ArkClassValidator = ArkClassValidator;
class ArkFileValidator extends Validator_1.FileValidator {
    validate(file, ctx) {
    }
}
exports.ArkFileValidator = ArkFileValidator;
