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

let someArray = [1, "string", false];

for (let entry of someArray) {
    console.info(entry); // 1, "string", false
}

let list = [4, 5, 6];

for (let i in list) {
    console.info(i); // "0", "1", "2",
}

for (let i of list) {
    console.info(i); // "4", "5", "6"
}

list.forEach(i => {
    console.info(i);
});

for (let i = 0; i < list.length; i++) {
    if (i == 0) {
        console.log('continue');
        continue;
    }
    if (i == 2) {
        console.log('break');
        break;
    }
    console.info(list[i]);
}

let pets = new Set(["Cat", "Dog", "Hamster"]);
for (let pet in pets) {
    console.info(pet); // "species"
}

for (let pet of pets) {
    console.info(pet); // "Cat", "Dog", "Hamster"
}

let i = 0;
do {
    if (i == 0) {
        continue;
    }
    if (i == 2) {
        break;
    }
    console.info(list[i]);
} while (i++ < list.length);

i = list.length;
while (i-- < list.length) {
    if (i == 0) {
        continue;
    }
    if (i == 2) {
        break;
    }
    console.info(list[i]);
}

i = list.length;
while (--i < list.length) {
    if (i == 0) {
        continue;
    }
    if (i == 2) {
        break;
    }
    console.info(list[i]);
}