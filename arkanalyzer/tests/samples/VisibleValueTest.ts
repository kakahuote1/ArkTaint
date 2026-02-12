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
import { Value } from '../../src';
import { DEFAULT_ARK_CLASS_NAME } from '../../src';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'VisibleValueTest');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);


export class VisibleValueTest {
    public buildScene(): Scene {
        const prjDir = "tests/resources/visiblevalue";
        let config: SceneConfig = new SceneConfig();
        config.buildFromProjectDir(prjDir);
        let projectScene: Scene = new Scene();
        projectScene.buildSceneFromProjectDir(config);
        return projectScene;
    }

    public testSimpleVisibleValue(): void {
        const scene = visibleValueTest.buildScene();
        const visibleValue = scene.getVisibleValue();

        for (const arkFile of scene.getFiles()) {
            visibleValue.updateIntoScope(arkFile);
            this.printVisibleValues(visibleValue.getCurrVisibleValues());
            for (const arkClass of arkFile.getClasses()) {
                if (arkClass.getName() == DEFAULT_ARK_CLASS_NAME) {
                    continue;
                }

                visibleValue.updateIntoScope(arkClass);
                this.printVisibleValues(visibleValue.getCurrVisibleValues());
                for (const arkMethod of arkClass.getMethods()) {
                    visibleValue.updateIntoScope(arkMethod);
                    this.printVisibleValues(visibleValue.getCurrVisibleValues());

                    const cfg = arkMethod.getBody()!.getCfg();
                    for (const block of cfg.getBlocks()) {
                        visibleValue.updateIntoScope(block);
                        this.printVisibleValues(visibleValue.getCurrVisibleValues());

                        visibleValue.updateOutScope();
                        this.printVisibleValues(visibleValue.getCurrVisibleValues());
                    }

                    visibleValue.updateOutScope();
                    this.printVisibleValues(visibleValue.getCurrVisibleValues());
                }
                visibleValue.updateOutScope();
                this.printVisibleValues(visibleValue.getCurrVisibleValues());
            }
            visibleValue.updateOutScope();
            this.printVisibleValues(visibleValue.getCurrVisibleValues());
        }
    }

    private printVisibleValues(values: Value[]): void {
        logger.info('*** visible values ***');
        for (const value of values) {
            logger.info(value.toString());
        }
    }

    public testScopeChain(): void {
        const scene = visibleValueTest.buildScene();
        const visibleValue = scene.getVisibleValue();

        for (const arkFile of scene.getFiles()) {
            logger.info('=============== arkFile:', arkFile.getName(), '================');
            visibleValue.updateIntoScope(arkFile);
            let scopeChain = visibleValue.getScopeChain();
            logger.info(scopeChain[0].depth);
        }
    }
}

const visibleValueTest = new VisibleValueTest();
visibleValueTest.testSimpleVisibleValue();
visibleValueTest.testScopeChain();