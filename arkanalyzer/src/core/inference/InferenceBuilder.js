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
exports.InferenceBuilder = void 0;
const ModelInference_1 = require("./ModelInference");
const ValueInference_1 = require("./ValueInference");
class InferenceBuilder {
    buildFileInference() {
        return new ModelInference_1.FileInference(this.buildImportInfoInference(), this.buildClassInference());
    }
    buildClassInference() {
        return new ModelInference_1.ClassInference(this.buildMethodInference());
    }
    buildMethodInference() {
        return new ModelInference_1.MethodInference(this.buildStmtInference());
    }
    getValueInferences(lang) {
        return Array.from(ValueInference_1.valueCtors.entries()).filter(entry => entry[1] === lang)
            .map(entry => {
            const valueCtor = entry[0];
            return new valueCtor();
        });
    }
}
exports.InferenceBuilder = InferenceBuilder;
//# sourceMappingURL=InferenceBuilder.js.map