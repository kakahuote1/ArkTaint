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
import { DummyMainCreater } from '../../src';
import { DEFAULT_ARK_METHOD_NAME } from '../../src';


const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'TypeInferenceTest');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);

export class TypeInferenceTest {
    public buildScene(): Scene {
        const config_path = "tests/resources/typeInference/ProjectTypeInferenceTestConfig.json";
        let config: SceneConfig = new SceneConfig();
        config.buildFromJson(config_path);
        const scene = new Scene();
        scene.buildBasicInfo(config);
        scene.buildScene4HarmonyProject();
        const creater = new DummyMainCreater(scene);
        creater.createDummyMain();
        return scene;
    }

    public testLocalTypes() {
        let scene = this.buildScene();
        logger.info(`before inferTypes`);
        this.printLocalTypes(scene);
        scene.inferTypes();
        logger.info(``);
        logger.info(`after inferTypes`);
        this.printLocalTypes(scene);
    }


    public printLocalTypes(scene: Scene) {
        for (const arkFile of scene.getFiles()) {
            logger.info('=============== arkFile:', arkFile.getName(), ' ================');
            for (const arkClass of arkFile.getClasses()) {
                logger.info('========= arkClass:', arkClass.getName(), ' =======');
                for (const arkMethod of arkClass.getMethods()) {
                    logger.info('***** arkMethod: ', arkMethod.getName());
                }
            }
        }
    }

    public testFunctionReturnType() {
        let scene = this.buildScene();

        for (const arkFile of scene.getFiles()) {
            logger.info('=============== arkFile:', arkFile.getName(), ' ================');
            for (const arkClass of arkFile.getClasses()) {
                for (const arkMethod of arkClass.getMethods()) {
                    if (arkMethod.getName() == DEFAULT_ARK_METHOD_NAME) {
                        continue;
                    }

                    logger.info(arkMethod.getSubSignature().toString());
                }
            }
        }
    }

    public testTypeInference(): void {
        let scene = this.buildScene();
        scene.inferTypes();
    }
}

logger.info('type inference test start');
let typeInferenceTest = new TypeInferenceTest();
typeInferenceTest.testTypeInference();
typeInferenceTest.testLocalTypes();
typeInferenceTest.testFunctionReturnType();
logger.info('type inference test end\n');
