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
import { PrinterBuilder } from '../../src';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'SaveTest');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);


function testAppProjectSave() {
    let config: SceneConfig = new SceneConfig();
    config.buildFromJson('./tests/resources/AppTestConfig.json');
    let scene: Scene = new Scene();
    scene.buildBasicInfo(config);
    logger.info('start ... ');
    scene.buildScene4HarmonyProject();
    scene.inferTypes();
    logger.info('end inferTypes ... ');

    for (let cls of scene.getClasses()) {
        if (cls.hasComponentDecorator()) {
            cls.getViewTree();
        }
    }
    logger.info('end build viewtree ... ');

    let printer: PrinterBuilder = new PrinterBuilder('out/project');
    for (let f of scene.getFiles()) {
        printer.dumpToTs(f);
    }
    logger.info('end dumpToTs ... ');
}

function testSimpleSave() {
    let config: SceneConfig = new SceneConfig();
    config.buildFromProjectDir('tests/resources/save');
    let scene: Scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    let printer: PrinterBuilder = new PrinterBuilder('out/save');
    for (let f of scene.getFiles()) {
        printer.dumpToTs(f);
    }
    logger.info('testSimpleSave end dumpToTs ... ');
}

testAppProjectSave();
testSimpleSave();
