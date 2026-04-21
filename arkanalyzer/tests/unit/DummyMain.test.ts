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

import { DummyMainCreater, Scene, SceneConfig } from '../../src/index';
import { describe, expect, it } from 'vitest';
import path from 'path';
import { Sdk } from '../../src/Config';

const SDK_DIR = path.join(__dirname, '../../tests/resources/Sdk');
const sdk: Sdk = {
    name: '',
    path: SDK_DIR,
    moduleName: ''
};

function buildScene(projectPath: string): Scene {
    let config: SceneConfig = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    config.buildFromProjectDir(projectPath);
    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('DummyMainTest1', () => {
    const scene = buildScene('tests/resources/dummyMain/normal');
    const creater = new DummyMainCreater(scene);
    creater.createDummyMain();
    let dummyMain = creater.getDummyMain();

    it('case1: Ability LifeCycle', () => {
        expect(creater.getMethodsFromAllAbilities().length).eq(6);
        const cfg = dummyMain.getCfg()!;
        expect(cfg.getBlocks().size).eq(23);
        expect(cfg.getStartingBlock()).not.eq(undefined);
    });
});

describe('DummyMainTest2', () => {
    const scene = buildScene('tests/resources/dummyMain/child');
    const creater = new DummyMainCreater(scene);
    creater.createDummyMain();

    it('case2: child LifeCycle', () => {
        expect(creater.getMethodsFromAllAbilities().length).eq(12);
    });
});

describe('DummyMainTest3', () => {
    const scene = buildScene('tests/resources/dummyMain/param');
    const creater = new DummyMainCreater(scene);
    creater.createDummyMain();

    it('case3: LifeCycle Params', () => {
        expect(creater.getMethodsFromAllAbilities().length).eq(2);
        expect([...creater.getDummyMain().getCfg()!.getBlocks()][3].getStmts().length).eq(2);
    });
});

describe('DummyMainTest4', () => {
    const scene = buildScene('tests/resources/dummyMain/entry_methods_order');
    const creater = new DummyMainCreater(scene);
    creater.createDummyMain();

    it('case4: Entry Method Order', () => {
        expect(creater.getCallbackMethods().length).eq(3);
        expect(creater.getCallbackMethods()[0].getName()).eq(`%AM0$foo`);
        expect(creater.getCallbackMethods()[1].getName()).eq(`%AM0$goo`);
        expect(creater.getCallbackMethods()[2].getName()).eq(`%AM0$build`);
    });
});

describe('DummyMainTest5', () => {
    const scene = buildScene('tests/resources/dummyMain/static');
    const creater = new DummyMainCreater(scene);
    creater.createDummyMain();

    it('case5: static method', () => {
        expect(creater.getMethodsFromAllAbilities().length).eq(2);
    });
});