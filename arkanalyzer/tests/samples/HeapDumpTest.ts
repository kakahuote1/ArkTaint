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
import { join } from 'path';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';
import { writeHeapSnapshot } from 'v8';

const logPath = 'out/ArkAnalyzer.log';
const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'HeapDumpTest');
Logger.configure(logPath, LOG_LEVEL.ERROR, LOG_LEVEL.DEBUG, true);

const PROJECT_ROOT = 'tests/resources/viewtree/project';
const PROJECT_NAME = 'project';
const MODULES = new Map<string, string>();

function snapshot(name: string): void {
    logger.info(`${name} snapshot start.`);
    writeHeapSnapshot(`Heap-${Math.ceil(new Date().getTime() / 1000)}-${name}.heapsnapshot`);
    logger.info(`${name} snapshot end.`);
}

function testAppProject(): void {
    let config: SceneConfig = new SceneConfig();
    config.buildConfig(PROJECT_NAME, PROJECT_ROOT, []);
    const supportFileExts = config.getOptions().supportFileExts!;
    let scene: Scene = new Scene();
    scene.buildBasicInfo(config);
    logger.info('start ... ');

    if (MODULES.size > 0) {
        for (const [moduleName, modulePath] of MODULES) {
            scene.buildModuleScene(moduleName, join(PROJECT_ROOT, modulePath), supportFileExts);
        }
    } else {
        scene.buildScene4HarmonyProject();
    }
    snapshot('buildScene');
    scene.inferTypes();
    snapshot('inferTypes');
    logger.info('end inferTypes ... ');
}

snapshot('start');
testAppProject();
snapshot('end');
