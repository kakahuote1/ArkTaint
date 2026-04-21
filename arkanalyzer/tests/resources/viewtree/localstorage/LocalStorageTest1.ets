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

class PropB {
 code: number;

 constructor(code: number) {
   this.code = code;
 }
}

let para: Record<string, number> = { 'PropA': 47 };
let storage: LocalStorage = new LocalStorage(para);
storage.setOrCreate('PropB', new PropB(50));

@Component
struct Child {
 @LocalStorageLink('PropA') childLinkNumber: number = 1;
 @LocalStorageLink('PropB') childLinkObject: PropB = new PropB(0);

 build() {
   Column() {
     Button(`Child from LocalStorage ${this.childLinkNumber}`) 
       .onClick(() => {
         this.childLinkNumber += 1;
       })
     Button(`Child from LocalStorage ${this.childLinkObject.code}`) 
       .onClick(() => {
         this.childLinkObject.code += 1;
       })
   }
 }
}

@Entry(storage)
@Component
struct LocalStorageTest1 {
 @LocalStorageLink('PropA') parentLinkNumber: number = 1;
 @LocalStorageLink('PropB') parentLinkObject: PropB = new PropB(0);
 @Type((a: number):number => Person) sendable: number;

 build() {
   Column({ space: 15 }) {
     Button(`Parent from LocalStorage ${this.parentLinkNumber}`) // initial value from LocalStorage will be 47, because 'PropA' initialized already
       .onClick(() => {
         this.parentLinkNumber += 1;
       })

     Button(`Parent from LocalStorage ${this.parentLinkObject.code}`) // initial value from LocalStorage will be 50, because 'PropB' initialized already
       .onClick(() => {
         this.parentLinkObject.code += 1;
       })

     Child()
   }
 }
}