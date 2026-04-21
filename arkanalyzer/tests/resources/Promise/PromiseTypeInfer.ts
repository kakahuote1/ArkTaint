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

import { media } from '@kit.MediaKit';
import { BusinessError } from '@kit.BasicServicesKit';

async function test2(): Promise<void> {
    await media.createAVPlayer().then((player) => {
        if (player !== null) {
            player.on('audioInterrupt', () => {
                console.error('createAVPlayer audioInterrupt2');
            });
        } else {
            console.log('createAVPlayer: error');
        }
    }).catch((error: BusinessError) => {
        console.log('createAVPlayer: error:${error}');
    });
}