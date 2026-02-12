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

import { SceneConfig } from '../../src';
import { Scene } from '../../src';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'APPTEST');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);

let config: SceneConfig = new SceneConfig();

// build from json
config.buildFromJson('./tests/resources/AppTestConfig.json');
function runScene4Json(config: SceneConfig) {
    let projectScene: Scene = new Scene();
    projectScene.buildBasicInfo(config);
    projectScene.buildScene4HarmonyProject();
    projectScene.inferTypes();
    logger.info('runScene4Json exit.');
}
runScene4Json(config);