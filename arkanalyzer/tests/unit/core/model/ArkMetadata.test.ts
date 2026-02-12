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

import { DEFAULT_ARK_CLASS_NAME, DEFAULT_ARK_METHOD_NAME, Scene, SceneConfig, Stmt } from '../../../../src';
import path from 'path';
import { assert, describe, expect, it } from 'vitest';
import { ArkMetadataKind, CommentsMetadata } from '../../../../src/core/model/ArkMetadata';
import { Stmt_Metadata_Expected } from '../../../resources/model/metadata/MetadataExpect';

describe('metadata Test', () => {
    const scene = buildScene('');

    it('test stmt metadata', async () => {
        assertStmtsMetadataEqual(scene, 'MetadataTest.ts', Stmt_Metadata_Expected.stmts);
    });
});

const BASE_DIR = path.join(__dirname, '../../../../tests/resources/model/metadata');

function buildScene(folderName: string): Scene {
    const sceneOptions = { enableTrailingComments: true, enableLeadingComments: true };
    let config: SceneConfig = new SceneConfig(sceneOptions);
    config.buildFromProjectDir(path.join(BASE_DIR, folderName));
    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    return scene;
}

function assertStmtsMetadataEqual(scene: Scene, fileName: string, expectStmts: any[],
                                  className: string = DEFAULT_ARK_CLASS_NAME,
                                  methodName: string = DEFAULT_ARK_METHOD_NAME): void {
    const arkFile = scene.getFiles().find((file) => file.getName().endsWith(fileName));
    const arkMethod = arkFile?.getClassWithName(className)?.getMethods()
        .find((method) => (method.getName() === methodName));
    const stmts = arkMethod?.getCfg()?.getStmts();
    if (!stmts) {
        assert.isDefined(stmts);
        return;
    }

    expect(stmts.length).toEqual(expectStmts.length);
    for (let i = 0; i < stmts.length; i++) {
        expect(stmts[i].toString()).toEqual(expectStmts[i].text);

        const actualLeadingComments = getCommentsMetadata(stmts[i], ArkMetadataKind.LEADING_COMMENTS);
        expect(actualLeadingComments).toEqual(expectStmts[i].leadingComments);

        const actualTrailingComments = getCommentsMetadata(stmts[i], ArkMetadataKind.TRAILING_COMMENTS);
        expect(actualTrailingComments).toEqual(expectStmts[i].trailingComments);
    }
}

function getCommentsMetadata(stmt: Stmt, metadataKind: ArkMetadataKind): any[] {
    const commentsMetadata = stmt.getMetadata(metadataKind);
    const comments = commentsMetadata instanceof CommentsMetadata ? commentsMetadata.getComments() : [];
    return comments.map(comment => ({
        content: comment.content,
        position: [
            comment.position.getFirstLine(),
            comment.position.getFirstCol(),
            comment.position.getLastLine(),
            comment.position.getLastCol(),
        ],
    }));
}