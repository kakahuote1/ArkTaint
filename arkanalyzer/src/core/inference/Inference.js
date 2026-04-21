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
exports.InferenceManager = void 0;
const ArkFile_1 = require("../model/ArkFile");
const ArkTsInference_1 = require("./arkts/ArkTsInference");
const AbcInference_1 = require("./abc/AbcInference");
const ValueInference_1 = require("./ValueInference");
class InferenceManager {
    constructor() {
        this.inferenceMap = new Map();
    }
    static getInstance() {
        if (!InferenceManager.instance) {
            InferenceManager.instance = new InferenceManager();
        }
        return InferenceManager.instance;
    }
    getInference(lang) {
        const inferLanguage = this.changeToInferLanguage(lang);
        let inference = this.inferenceMap.get(inferLanguage);
        if (!inference) {
            if (inferLanguage === ValueInference_1.InferLanguage.ARK_TS1_1) {
                inference = new ArkTsInference_1.ArkTsInferenceBuilder().buildFileInference();
            }
            else if (inferLanguage === ValueInference_1.InferLanguage.ABC) {
                inference = new AbcInference_1.AbcInferenceBuilder().buildFileInference();
            }
            else if (inferLanguage === ValueInference_1.InferLanguage.JAVA_SCRIPT) {
                inference = new ArkTsInference_1.JsInferenceBuilder().buildFileInference();
            }
            else if (inferLanguage === ValueInference_1.InferLanguage.ARK_TS1_2) {
                inference = new ArkTsInference_1.ArkTs2InferenceBuilder().buildFileInference();
            }
            else {
                throw new Error('Inference not supported');
            }
            this.inferenceMap.set(inferLanguage, inference);
        }
        return inference;
    }
    changeToInferLanguage(lang) {
        if (lang === ArkFile_1.Language.ARKTS1_1 || lang === ArkFile_1.Language.TYPESCRIPT) {
            return ValueInference_1.InferLanguage.ARK_TS1_1;
        }
        else if (lang === ArkFile_1.Language.ABC) {
            return ValueInference_1.InferLanguage.ABC;
        }
        else if (lang === ArkFile_1.Language.JAVASCRIPT) {
            return ValueInference_1.InferLanguage.JAVA_SCRIPT;
        }
        else if (lang === ArkFile_1.Language.ARKTS1_2) {
            return ValueInference_1.InferLanguage.ARK_TS1_2;
        }
        return ValueInference_1.InferLanguage.UNKNOWN;
    }
}
exports.InferenceManager = InferenceManager;
//# sourceMappingURL=Inference.js.map