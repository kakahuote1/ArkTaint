import { PasswordInput } from "../components/PasswordInput";

@Entry
@Component
struct LoginPage {
    build() {
        const pwd = new PasswordInput();
        pwd.setPassword("from_parent");
        pwd.build();
    }
}
