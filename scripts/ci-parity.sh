#!/bin/sh
# 本地模拟 CI：干净克隆 + frozen-lockfile 安装 + 全套校验。
# 本地检查通过 ≠ CI 通过（本地绝对路径等只在干净克隆里暴露）；push 前由 pre-push 钩子触发。
set -eu

repo=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-diary-ci.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

git clone --quiet "$repo" "$tmp/repo"
cd "$tmp/repo"

sh scripts/check-local-paths.sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
git diff --exit-code -- lib/

echo 'ci-parity: 全部通过（等价于 CI 全流程）'
