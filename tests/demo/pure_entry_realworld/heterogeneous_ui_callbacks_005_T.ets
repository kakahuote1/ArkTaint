// Case: Complex form with multiple heterogeneous UI callbacks
// Real settings page with TextInput, Slider, Toggle, Search, Tabs
import { TextInput, Slider, Toggle, Search, Tabs, Button, taint } from "./taint_mock";

class SettingsPage {
    private username: string = "";
    private brightness: number = 50;
    private darkMode: boolean = false;
    private searchQuery: string = "";
    private activeTab: number = 0;

    aboutToAppear(): void {
        this.loadSettings();
    }

    build(): void {
        const nameInput = new TextInput();
        nameInput.onChange((value: string) => {
            this.username = value;
            taint.Sink(this.username);
        });
        nameInput.onSubmit((enterKey: number) => {
            taint.Sink(enterKey);
            this.saveUsername(this.username);
        });

        const brightnessSlider = new Slider();
        brightnessSlider.onChange((value: number, mode: number) => {
            this.brightness = value;
            taint.Sink(mode);
        });

        const darkModeToggle = new Toggle();
        darkModeToggle.onChange((isOn: boolean) => {
            this.darkMode = isOn;
            this.applyTheme(isOn);
        });

        const searchBar = new Search();
        searchBar.onSubmit((value: string) => {
            taint.Sink(value);
        });
        searchBar.onChange((value: string) => {
            this.searchQuery = value;
        });

        const tabs = new Tabs();
        tabs.onChange((index: number) => {
            this.activeTab = index;
        });
        tabs.onTabBarClick((index: number) => {
            taint.Sink(index);
        });

        const saveBtn = new Button();
        saveBtn.onClick(() => {
            this.saveAllSettings();
        });
        saveBtn.onHover((isHover: boolean) => {
            void isHover;
        });
    }

    onPageShow(): void {
        this.refreshSettings();
    }

    onPageHide(): void {
        this.saveAllSettings();
    }

    private loadSettings(): void {}
    private refreshSettings(): void {}
    private saveUsername(name: string): void { void name; }
    private applyTheme(dark: boolean): void { void dark; }
    private saveAllSettings(): void {
        taint.Sink(this.username + this.brightness + this.darkMode);
    }
}

export { SettingsPage };
