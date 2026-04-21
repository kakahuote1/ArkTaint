/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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
import { CallGraph, CallGraphNode } from '../../src';
import { CallGraphBuilder } from '../../src';
import { SCCDetection } from '../../src';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'SCCTEST');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);
let config: SceneConfig = new SceneConfig();

function runDir(): CallGraph {
    config.buildFromProjectDir('./tests/resources/scc');

    let projectScene: Scene = new Scene();
    projectScene.buildSceneFromProjectDir(config);
    projectScene.inferTypes();

    let cg = new CallGraph(projectScene);
    let cgBuilder = new CallGraphBuilder(cg, projectScene);
    cgBuilder.buildDirectCallGraphForScene();
    cg.dump('out/scccg.dot');
    return cg;
}

let cg = runDir();
let scc = new SCCDetection<CallGraph>(cg);
scc.find();

let topo = scc.getTopoAndCollapsedNodeStack();
logger.info(topo);
while (topo.length > 0) {
    let n = topo.pop()!;

    let f: CallGraphNode = cg.getNode(n) as CallGraphNode;
    logger.info(f.getMethod().getMethodSubSignature().getMethodName());
    let subn = scc.getSubNodes(n);
    subn.forEach(s => {
        let f: CallGraphNode = cg.getNode(s) as CallGraphNode;
        logger.info('  ' + f.getMethod().getMethodSubSignature().getMethodName());
    });
}

logger.info('===\n');
for (let n of cg.getNodesIter()) {
    let sccNodes = scc.getMySCCNodes(n.getID());
    logger.info((n as CallGraphNode).getMethod().getMethodSubSignature().getMethodName());

    for (let sn of sccNodes) {
        logger.info('  ' + (cg.getNode(sn) as CallGraphNode).getMethod().getMethodSubSignature().getMethodName());
    }
}
logger.info('test finish\n');