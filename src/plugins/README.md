# Engine Plugins

Put built-in engine process extensions in this directory.

- one normal `.ts` file can export one or more plugins
- `enabled: false` disables the current plugin in-file
- `--disable-plugins <name>` disables a plugin by name at runtime

The core plugin runtime and loader stay under `src/core/orchestration/plugins/**`.
