#!/bin/sh
# 公开仓库守卫：提交树不得含本机绝对路径或本地路径协议依赖。
# CI 与 scripts/ci-parity.sh 共用；模式中 [m] 技巧避免脚本匹配自身。
set -eu

status=0

# 依赖清单里的本地路径协议（link:/file:/portal: 绝对路径在 CI 不可解析；
# 相对 link: 由 ci-parity 的 frozen-lockfile 安装兜底）
hits=$(git grep -nE '(link|file|portal):/' HEAD -- package.json pnpm-lock.yaml || true)
if [ -n "$hits" ]; then
  echo '::error::依赖清单含本地路径协议，CI 无法解析，请改用 registry 版本：'
  echo "$hits"
  status=1
fi

# 任意被跟踪文件里的本机用户路径标记（scripts/ 豁免：模式本身在此）
hits=$(git grep -nE '/Users/zh[m]20001' HEAD -- . ':!scripts' || true)
if [ -n "$hits" ]; then
  echo '::error::提交文件含本机用户路径：'
  echo "$hits"
  status=1
fi

exit $status
