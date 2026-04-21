/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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

import { SceneConfig, Scene, ClassSignature } from "../../src";
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'DummyCallTest');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);

// let etsSdk: Sdk = {
//     name: "ohos",
//     path: "/Users/yangyizhuo/Library/OpenHarmony/Sdk/11/ets",
//     moduleName: ""
// }

let config: SceneConfig = new SceneConfig();
// config.buildConfig("uiTest", "/Users/yangyizhuo/Desktop/code/arkanalyzer/tests/resources/pta/uiTest",
//     [etsSdk], [
//         "./tests/resources/pta/uiTest/ui_test.ts"
//     ])
// config.buildFromJson('./tests/resources/pta/PointerAnalysisTestConfig.json');
config.buildFromProjectDir('./tests/resources/pta/singleton');

function runScene(config: SceneConfig, output: string) {
    let projectScene: Scene = new Scene();
    // projectScene.buildSceneFromProjectDir(config);
    projectScene.buildBasicInfo(config);
    projectScene.buildScene4HarmonyProject();
    projectScene.inferTypes();

    let classSigs: ClassSignature[] = [];
    classSigs.push(...
        projectScene.getFiles()
            .filter(arkFile => arkFile.getName() === 'entry/src/main/ets/common/ButtonComponent.ets')
            .flatMap(arkFile => arkFile.getClasses())
            .filter(arkClass => arkClass.getName() === 'ButtonComponent')
            .flatMap(arkClass => arkClass.getSignature())
    );

    // let dummyCallCreator = new DummyCallCreator(projectScene)
    // dummyCallCreator.getDummyCallByComponent(classSigs[0])
    logger.log('fin');
}
runScene(config, './out/applications_camera');