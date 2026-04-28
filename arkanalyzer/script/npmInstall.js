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

'use strict';
const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

function ohosTypescriptPresent() {
    const arkanalyzerRoot = path.resolve(__dirname, '..');
    const candidate = path.join(arkanalyzerRoot, 'node_modules', 'ohos-typescript');
    try {
        const st = fs.statSync(candidate);
        return st.isDirectory();
    } catch {
        return false;
    }
}

async function execCommand(command) {
    console.log(command);
    let result = await execSync(command, {encoding: 'utf-8'});
    console.log(result);
}

function removeFolder(folderPath) {
    console.log(`start to remove '${folderPath}'`);
    fs.rmSync(folderPath, {recursive: true, force: true});
    console.log();
}

async function runCommands() {
    if (ohosTypescriptPresent()) {
        console.log('[npmInstall] ohos-typescript already present; skipping arktools bootstrap.');
        return;
    }
    const arkanalyzerRoot = path.resolve(__dirname, '..');
    const arktoolsDir = path.join(arkanalyzerRoot, 'arktools');
    const tgzPath = path.join(arktoolsDir, 'lib', 'ohos-typescript-4.9.5-r4-OpenHarmony-6.0-Release.tgz');
    const prevCwd = process.cwd();
    try {
        process.chdir(arkanalyzerRoot);
        removeFolder(arktoolsDir);
        await execCommand('git clone https://gitee.com/yifei-xue/arktools.git');
        // --ignore-scripts avoids re-entering this package's postinstall (recursive npm install failure).
        await execCommand(`npm install "${tgzPath}" --no-save --ignore-scripts`);
        removeFolder(arktoolsDir);
    } catch (error) {
        console.error(error);
    } finally {
        try {
            process.chdir(prevCwd);
        } catch {
            /* ignore */
        }
    }
}

runCommands();