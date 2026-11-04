#!/bin/sh
set -eu
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$#" -eq 5 ] || fail '请从后台重新复制完整升级命令'
[ "$(uname -s)" = Linux ] || fail '仅支持 Linux 宿主'
[ "$(id -u)" -eq 0 ] || fail '请使用 sudo 执行升级命令'
case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) fail '仅支持 amd64 / arm64' ;; esac
[ "$arch" = "$3" ] || fail '宿主架构与后台选择不一致，请重新生成命令'
case "$1" in https://*) ;; *) fail '后台地址必须使用 HTTPS' ;; esac
case "$2" in ''|[.-]*|*[!a-zA-Z0-9._-]*) fail '发行版本无效' ;; esac
for digest in "$4" "$5"; do
 case "$digest" in ''|*[!a-f0-9]*) fail '校验摘要无效' ;; esac
 [ "${#digest}" -eq 64 ] || fail '校验摘要长度无效'
done
for tool in curl sha256sum mktemp systemctl systemd-run; do command -v "$tool" >/dev/null 2>&1 || fail "缺少工具: $tool"; done
[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'
work=
trap '[ -z "$work" ] || rm -rf "$work"' EXIT
probe=/bin/true
[ -f "$probe" ] || probe=/usr/bin/true
for root in /var/tmp /opt/monkeyai-engine/tmp; do
 [ ! -L "$root" ] || continue
 mkdir -p "$root" 2>/dev/null || continue
 candidate=$(mktemp -d "$root/monkeyai-engine.XXXXXX") || continue
 if cp "$probe" "$candidate/true" && chmod 700 "$candidate/true" && "$candidate/true" 2>/dev/null; then
  work=$candidate
  break
 fi
 rm -rf "$candidate"
done
[ -n "$work" ] || fail '找不到允许执行的私有临时目录'
trap 'exit 1' HUP INT TERM
[ -f /etc/monkeyai-engine/config.json ] || fail '宿主尚未接入，请先使用安装命令'
printf '下载并校验 installer / engine %s（%s）升级程序…\n' "$2" "$arch"
curl -k --proto '=https' --tlsv1.2 --fail --show-error --progress-bar --retry 3 --connect-timeout 15 --max-time 900 "$1/api/host/v1/releases/$2/$3/installer" -o "$work/installer"
printf '%s  %s\n' "$4" "$work/installer" | sha256sum -c - >/dev/null || fail '升级程序校验失败'
chmod 700 "$work/installer"
systemd-run --unit=monkeyai-engine-upgrade --wait --pipe --collect --property=TimeoutStopSec=90 \
 "$work/installer" monkeyai-engine upgrade --server "$1" --release "$2" --architecture "$3" --manifest-sha256 "$5"
