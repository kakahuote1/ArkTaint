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

import { B } from './b';
import Logger from '../../../../../src/utils/logger';

let logger = Logger.getLogger()

export function A(){
    B();
}
class FieldB {
    public field_C: number
}

export abstract class Animal {
    public sound() {}
}

export class Dog extends Animal {
    public aaaaaaaaaa: number
    public static num = 1
    public sound() {
        console.log("Dog.sound(){")
        let cat = new Cat()
        cat.sound()
        this.sleep()
        console.log("}")
    }

    public static print() {
        console.log("Dog.print(){")
        logger.info("waht")
        console.log("}")
    }

    public sleep() {
        console.log("Dog.sleep(){")
        console.log("}")
    }

    public getDog(): Dog {
        console.log("Dog.getDog(){")
        console.log("}")
        return this
    }

    public returnStr(str: string): string {
        console.log("Dog.returnStr(){")
        console.log("}")
        return str + "3"
    }
}

export class Cat extends Animal {
    public sound() {
        console.log("Cat.sound(){")
        logger.info("meewo")
        console.log("}")
    }

    public testWithParams(a: Dog): void {
        console.log("Cat.testWithParams(){")
        this.sound()
        a.sleep()
        console.log("}")
    }

    public getCat(): Cat {
        console.log("Cat.getCat(){")
        console.log("}")
        return this
    }

    public static getNum(): number {
        console.log("Cat.getNum(){")
        console.log("}")
        return 1 + 2
    }
}

export class Main {
    public static makeAnimalSound(animal: Animal) {
        console.log("Main.makeAnimalSound(){")
        animal.sound()
        console.log("}")
    }

    public static main() {
        console.log("Main.main(){")
        this.makeAnimalSound(new Dog())
        console.log("}")
    }

    public getMain(): Main {
        console.log("Main.getMain(){")
        console.log("}")
        return this
    }

    public static printNumber(num: number): string {
        console.log("Main.printNumber(){")
        console.log(num)
        console.log("}")
        return "success"
    }
}

export class FieldA {
    public field_A: string
    public field_B: FieldB
}

export namespace dd {

}