/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License"); * you may not use this file except in compliance with the License.
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
import { SceneConfig, Scene } from '../../src';
import { DVFG } from '../../src/VFG/DVFG';
import { DVFGBuilder } from '../../src/VFG/builder/DVFGBuilder';
import { CallGraph } from '../../src/callgraph/model/CallGraph';

let config: SceneConfig = new SceneConfig();
function runDir(): Scene {
    config.buildFromProjectDir('tests/resources/reachingDef');
    let projectScene: Scene = new Scene();
    projectScene.buildSceneFromProjectDir(config);
    projectScene.inferTypes();

    return projectScene;
}

let scene = runDir();

let cg = new CallGraph(scene);
let dvfg = new DVFG(cg);
let dvfgBuilder = new DVFGBuilder(dvfg, scene);


let method = scene.getMethods().find(m => m.getName() === 'test1');
dvfgBuilder.buildForSingleMethod(method!);
method = scene.getMethods().find(m => m.getName() === 'test2');
dvfgBuilder.buildForSingleMethod(method!);

dvfg.dump('out/dvfg.dot');
