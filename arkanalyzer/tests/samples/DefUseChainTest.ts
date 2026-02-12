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
import { DEFAULT_ARK_METHOD_NAME } from '../../src';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'DefUseChainTest');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);

export class Test {
    public buildScene(): Scene {
        const prjDir = "tests/resources/defUseChain";
        let config: SceneConfig = new SceneConfig();
        config.buildFromProjectDir(prjDir);
        let projectScene: Scene = new Scene();
        projectScene.buildSceneFromProjectDir(config);
        return projectScene;
    }

    public test() {
        let scene = this.buildScene();
        scene.inferTypes();

        for (const arkFile of scene.getFiles()) {
            for (const arkClass of arkFile.getClasses()) {
                for (const arkMethod of arkClass.getMethods()) {
                    if (arkMethod.getName() == DEFAULT_ARK_METHOD_NAME) {
                        continue;
                    }
                    logger.info('*** arkMethod: ', arkMethod.getName());

                    const cfg = arkMethod.getBody()!.getCfg();
                    cfg.buildDefUseChain();
                    for (const chain of cfg.getDefUseChains()){
                        logger.info("variable: "+chain.value.toString()+", def: "+chain.def.toString()+", use: "+chain.use.toString());
                    }
                }
            }
        }
    }

    public testTypeInference(): void {
        let scene = this.buildScene();
        scene.inferTypes();
    }
}

let t = new Test();
t.test();
