declare function input(): string;
declare function sink(value: string): void;

interface Repository {
  send(value: string): void;
}

class RemoteRepository implements Repository {
  send(value: string): void {
    sink(value);
  }
}

class LocalRepository implements Repository {
  send(value: string): void {
    const ignored: string = value;
  }
}

@Entry
@Component
struct InterfaceDispatchPage {
  build() {
    const repo: Repository = new RemoteRepository();
    repo.send(input());
  }
}
