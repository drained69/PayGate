#!/bin/sh
# Builds both contracts into contract/res/. wasm-opt (binaryen) shrinks them, which lowers the
# storage each customer's vault locks for its code. Install it with `brew install binaryen`.
set -e
cd "$(dirname "$0")"
for crate in . factory; do
  (cd "$crate" && cargo build --release --target wasm32-unknown-unknown)
done
for name in paygate_vault:target paygate_factory:factory/target; do
  file=${name%%:*} dir=${name#*:}
  wasm-opt -Oz --strip-debug --strip-producers --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
    "$dir/wasm32-unknown-unknown/release/$file.wasm" -o "res/$file.wasm"
done
ls -l res/*.wasm
