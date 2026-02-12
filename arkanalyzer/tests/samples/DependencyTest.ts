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
import * as perf_hooks from 'perf_hooks';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'DEPTEST');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);
const performance = perf_hooks.performance;

class DependencyTest {
    public testBuildSceneByFiles(): void {

        const filesPath: string[] = ['./'];
        const projectDir = './tests/resources/dependency/exampleProject/MyApplication4Files';
        const projectName = 'MyApplication4Files';
        const sceneConfig: SceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectFiles(projectName, projectDir, filesPath);

        const scene: Scene = new Scene();
        scene.buildSceneFromFiles(sceneConfig);
        performance.mark('buildScene');
        scene.inferTypes();
        performance.mark('inferTypes');
        printMemPerfInfo();
    }
}

function printMemPerfInfo(): void {
    const usedRss = process.memoryUsage().rss;
    logger.info(`RSS Memory Size: ${Math.round(usedRss / 1024 / 1024 * 100) / 100} MB.`);
}

function printCPUPerfInfo(): void {
    performance.measure('start-to-end', 'start', 'end');
    performance.measure('start-to-buildScene', 'start', 'buildScene');
    performance.measure('buildScene-to-inferTypes', 'buildScene', 'inferTypes');
    performance.measure('inferTypes-to-end', 'inferTypes', 'end');

    let start_to_end = performance.getEntriesByName('start-to-end')[0].duration / 1000;
    let start_to_buildScene = performance.getEntriesByName('start-to-buildScene')[0].duration / 1000;
    let buildScene_to_inferTypes = performance.getEntriesByName('buildScene-to-inferTypes')[0].duration / 1000;
    let inferTypes_to_end = performance.getEntriesByName('inferTypes-to-end')[0].duration / 1000;

    logger.info('Take total time: ', start_to_end.toFixed(3), 's');
    logger.info('Detail: start <-', start_to_buildScene.toFixed(3),
        's -> buildScene <-', buildScene_to_inferTypes.toFixed(3),
        's -> inferTypes <-', inferTypes_to_end.toFixed(3),
        's -> end');
}



const dependencyTest = new DependencyTest();
performance.mark('start');
//文件按需构建加载
dependencyTest.testBuildSceneByFiles();

performance.mark('end');
printCPUPerfInfo();
