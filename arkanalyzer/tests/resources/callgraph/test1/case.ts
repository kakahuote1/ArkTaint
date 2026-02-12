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


export abstract class Animal {
    public sound(): void { };
    public getName(): string {
        return "Animal"
    }
    public getMe(): Animal{
        return this;
    };

    public run():void {
    }
}

export class Dog extends Animal {
    public aaaaaaaaaa: number
    public static num = 1
    public sound():void {
    }

    public static print() {
    }

    public sleep() {
    }

    public getName(): string {
        return "Dog";
    }
}

export class Cat extends Animal {
    public sound(): void {
    }

    public talkWith(a: Animal): void {
        this.sound();
        a.sound();
    }

    public run(): void {
    }

    public static getNum(): number {
        return 1 + 2;
    }
}

function makeTake(a: Cat, b: Animal) {
    a.talkWith(b);// cat.talkWith -> cat.sound; dog.sound
}

function foo() {
    //let dog: Animal = new Dog();
    let dog: Dog = new Dog();
    let cat = new Cat();
    makeTake(cat, dog);

    cat.getName(); //base
    dog.getName(); //dog

    cat.sound();//cat

    cat.run(); //cat
    dog.run(); //base

    let alias1 = cat.getMe();// base
    let alias2: Animal = dog.getMe();//base
    alias1.run();//cat
    alias2.run();//base
}

foo()