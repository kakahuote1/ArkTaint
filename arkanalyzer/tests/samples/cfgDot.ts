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
import { ArkBody } from '../../src';
import { DEFAULT_ARK_METHOD_NAME } from '../../src';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';
import { modifiers2stringArray } from '../../src/core/model/ArkBaseModel';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'CfgDot');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);

export class TypeInferenceTest {
    public buildScene(): Scene {
        const prjDir = "tests/resources/cfg/sample";
        let config: SceneConfig = new SceneConfig();
        config.buildFromProjectDir(prjDir);
        let projectScene: Scene = new Scene();
        projectScene.buildSceneFromProjectDir(config);
        return projectScene;
    }

    public testLocalTypes() {
        let scene = this.buildScene();
        scene.inferTypes();
        let num = 0;
        for (const arkFile of scene.getFiles()) {
            for (const arkClass of arkFile.getClasses()) {
                for (const arkMethod of arkClass.getMethods()) {
                    if (arkMethod.getModifiers() !== 0) {
                        num++
                        logger.info(`Methods: ${arkMethod.getName()} with Modifier: ${modifiers2stringArray(arkMethod.getModifiers())}`)
                    }
                }
            }
        }
        logger.info(`Num of Methods with Modifier: ${num}`)
    }

    public testFunctionReturnType() {
        let scene = this.buildScene();
        scene.inferTypes();

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

    public printStmts(body: ArkBody): void {
        logger.info('-- threeAddresStmts:');
        let cfg = body.getCfg();
        for (const threeAddresStmt of cfg.getStmts()) {
            logger.info(threeAddresStmt.toString());
        }
    }
}

let typeInferenceTest = new TypeInferenceTest();
typeInferenceTest.testLocalTypes();
typeInferenceTest.testFunctionReturnType();
