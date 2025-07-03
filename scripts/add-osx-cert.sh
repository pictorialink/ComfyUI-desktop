#!/bin/bash

# 名称: add-osx-cert.sh
# 说明: 此脚本在 electron-builder 签名后执行，主要用于处理 Electron 应用中的所有二进制文件
#      确保所有文件都使用有效的开发者 ID 证书签名并启用强化运行时。

set -e

# 检查是否为 macOS 环境
if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "此脚本仅适用于 macOS 环境"
  exit 0
fi

# 检查应用路径是否存在
if [ -z "$APP_PATH" ]; then
  APP_PATH="$1"
fi

if [ -z "$APP_PATH" ]; then
  echo "错误: 未提供应用路径"
  exit 1
fi

# 确保应用路径是目录且存在
if [ ! -d "$APP_PATH" ]; then
  echo "错误: 应用路径不是一个目录或不存在: $APP_PATH"
  exit 1
fi

echo "正在处理应用: $APP_PATH"

# 获取应用包内的所有可执行文件和库
echo "查找并签名所有二进制文件和库..."

# 签名所有 .dylib 文件
find "$APP_PATH" -name "*.dylib" -type f | while read -r file; do
  echo "签名 dylib: $file"
  codesign -f -o runtime --timestamp --entitlements "./scripts/entitlements.mac.plist" -s "$IDENTITY_NAME" "$file" || true
done

# 签名所有 .node 文件
find "$APP_PATH" -name "*.node" -type f | while read -r file; do
  echo "签名 node: $file"
  codesign -f -o runtime --timestamp --entitlements "./scripts/entitlements.mac.plist" -s "$IDENTITY_NAME" "$file" || true
done

# 签名 Electron Helper 应用
find "$APP_PATH" -path "*/Contents/Frameworks/Electron*Helper*.app" -type d | while read -r helper; do
  echo "签名 Electron Helper 应用: $helper"
  codesign -f -o runtime --timestamp --entitlements "./scripts/entitlements.mac.plist" -s "$IDENTITY_NAME" "$helper" || true
done

# 签名 framework
find "$APP_PATH" -path "*/Contents/Frameworks/*.framework" -type d | while read -r framework; do
  echo "签名 framework: $framework"
  codesign -f -o runtime --timestamp --entitlements "./scripts/entitlements.mac.plist" -s "$IDENTITY_NAME" "$framework" || true
done

# 签名所有可执行文件
find "$APP_PATH" -type f -perm +111 ! -path "*/.*" | while read -r file; do
  file_type=$(file -b "$file")
  if [[ $file_type == *"executable"* ]]; then
    echo "签名可执行文件: $file"
    codesign -f -o runtime --timestamp --entitlements "./scripts/entitlements.mac.plist" -s "$IDENTITY_NAME" "$file" || true
  fi
done

# 最后重新签名主应用
echo "重新签名主应用..."
codesign -f -o runtime --deep --timestamp --entitlements "./scripts/entitlements.mac.plist" -s "$IDENTITY_NAME" "$APP_PATH" || true

# 验证签名
echo "验证应用签名..."
codesign -vvv --deep "$APP_PATH"

echo "应用签名完成：$APP_PATH"
exit 0
