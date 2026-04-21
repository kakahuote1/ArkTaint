
import { Location } from '@ohos.geoLocationManager';
export class User{
  private info: Location;

  public  setInfo(info: string) {
    this.info = info;
  }

  public getInfo(): string {
    return this.info;
  }
}