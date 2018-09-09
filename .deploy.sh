#!/usr/bin/env sh

# 确保脚本抛出遇到的错误
set -e

# 生成静态文件
./node-v8.11.3-linux-x64/bin/npm run build


if [[ "$TRAVIS_OS_NAME" == "linux" && "$TRAVIS_PULL_REQUEST" = "false" && "$TRAVIS_BRANCH" == "master" ]]; then
  # cp CNAME docs/.vuepress/dist
  git clone https://github.com/davisp/ghp-import.git &&
  ./ghp-import/ghp_import.py -n -p -f -m "Documentation upload" -b master -r https:/"$TOKIOZH_TOKEN"@github.com/tokio-zh/tokio-zh.github.io.git docs/.vuepress/dist &&
  echo "Uploaded documentation"
fi
