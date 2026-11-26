# Browser core

The local site serves the prebuilt files in `public/core/`. HKID Utilities
1.2.1 performs the generation, strict validation, card formatting and holder
summaries in the browser. The adapter receives a Hong Kong reference date and
seeds each generated card using the browser's Web Crypto API.

To rebuild the bundle from the repository root with Rust 1.100.0:

```sh
rustup target add --toolchain 1.100.0 wasm32-unknown-unknown
cargo +1.100.0 install wasm-bindgen-cli --version 0.2.130 --locked
cargo +1.100.0 build --manifest-path core/Cargo.toml --target-dir core/target --target wasm32-unknown-unknown --release --locked
wasm-bindgen core/target/wasm32-unknown-unknown/release/hkid_web_core.wasm --target web --no-typescript --out-dir public/core
```

The Cargo lockfile pins the release dependencies. The published site includes
the [crate licenses and Unicode data notices](../public/core/THIRD-PARTY-NOTICES.txt)
and [Rust standard library notices](../public/core/RUST-STDLIB-LICENSES.zip).
The ZIP contains the toolchain's original copyright inventory and license texts.

When changing dependencies or toolchains, review the data and source attributions
in `core/update-notices.py`, then regenerate the notices with Python 3 and the
same Rust toolchain used for the WASM build.

```sh
rustup component add --toolchain 1.100.0 rust-docs
rustup run 1.100.0 python core/update-notices.py
```
