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

namespace Case1 {
    export interface Word {
        text: string;
        wordStartTime: number;
        duration: number;
    }
    export interface LrcEntry {
        lineStartTime: number;
        lineDuration: number;
        lineWords: string;
        words: Word[];
    }

    /**
     * LRC format lyrics.
     */
    const lrcLineRegex: RegExp = new RegExp('\\[\\d{2,}:\\d{2}((\\.|:)\\d{2,})\\]', 'g');
    const lrcTimeRegex1: RegExp = new RegExp('\\[\\d{2,}', 'i');
    const lrcTimeRegex2: RegExp = new RegExp('\\d{2}\\.\\d{2,}', 'i');

    export function parseLrcLyric(text: string): Array<LrcEntry> {
        if (!text) {
            return [];
        }
        let lyric: string[] = text.split('\n');
        let lrc = new Array<LrcEntry>();
        for (let i = 0; i < lyric.length; i++) {
            let lineTime = lyric[i].match(lrcLineRegex);
            let lineText = lyric[i].replace(lrcLineRegex, '');
            if (lineTime && lineText) {
                for (let j = 0; j < lineTime.length; j++) {
                    let min = Number(String(lineTime[j].match(lrcTimeRegex1)).slice(1));
                    let sec = Number.parseFloat(String(lineTime[j].match(lrcTimeRegex2)));
                    let timeInSeconds = (min * 60 + sec) * 1000;
                    lrc.push({ lineStartTime: timeInSeconds, lineDuration: 0, lineWords: lineText, words: [] });
                }
            }
        }
        if (lrc && lrc.length > 0) {
            lrc.sort((a, b) => {
                return a.lineStartTime - b.lineStartTime;
            });
            for (let i = 0; i < lrc.length; i++) {
                if (i === lrc.length - 1) {
                    lrc[i].lineDuration = Number.MAX_VALUE;
                } else {
                    lrc[i].lineDuration = lrc[i + 1].lineStartTime - lrc[i].lineStartTime;
                }
            }
        } else {
            console.error('Failed to parse the lyrics.');
        }
        return lrc;
    }
}

namespace Case2 {
    function dowhileTest(): void {
        for (let i = 0; i < 10; i++) {
            let x = 10;
            while (x > 10) {
                let y = 20;
                do {
                    console.log('x');
                } while (y < 10);
            }
        }
    }
}
