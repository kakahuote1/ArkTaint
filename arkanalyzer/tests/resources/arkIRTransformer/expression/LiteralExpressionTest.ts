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

const arr1 = [1, 2, 3];
const arr2 = [];
let arr3 = [1, 2, '3'];

// Template literals
const noSubstitutionTemplateLiteral = `no substitution template literal`;
const placeholder1: number = 1;
const templateLiteral1 = `raw text1, ${placeholder1}`;
const placeholder2: string = 'placeholder2';
const templateLiteral2 = `${placeholder2}, raw text2`;

// Tagged templates
function myTag(strings: any, ...optionalParams: any[]): void {
    console.log(strings, optionalParams);
}

const placeholder3: number = 3;
const placeholder4: string = 'placeholder4';
const output = myTag`raw text3, ${placeholder3} raw text4 ${placeholder4}.`;

