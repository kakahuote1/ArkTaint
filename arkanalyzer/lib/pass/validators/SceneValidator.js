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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneValidator = void 0;
const ScenePassMgr_1 = require("../ScenePassMgr");
const logger_1 = __importStar(require("../../utils/logger"));
const Validator_1 = require("./Validator");
const Models_1 = require("./Models");
require("./Exprs");
require("./Stmts");
require("./Values");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SceneValidator');
/**
 * The SceneValidator class is responsible for validating a given scene by leveraging the ScenePassMgr.
 * It sets up a context for validation, executes the validation process, and retrieves the summary of the validation.
 *
 * The validate method initializes a new SceneSummary instance, associates it with the current scene context,
 * runs the validation process using the configured manager, and finally returns the generated summary.
 *
 * This class ensures that the validation logic is encapsulated and provides a clean interface for processing scenes.
 */
class SceneValidator {
    constructor() {
        this.mgr = new ScenePassMgr_1.ScenePassMgr({
            passes: {
                file: [Models_1.ArkFileValidator],
                klass: [Models_1.ArkClassValidator],
                method: [Models_1.ArkMethodValidator],
            },
            dispatcher: Validator_1.ArkValidatorRegistry,
        });
    }
    validate(scene) {
        let summary = new Validator_1.SceneSummary();
        this.mgr.sceneContext().set(Validator_1.SceneSummary, summary);
        this.mgr.run(scene);
        logger.info('validate');
        return this.mgr.sceneContext().remove(Validator_1.SceneSummary);
    }
}
exports.SceneValidator = SceneValidator;
