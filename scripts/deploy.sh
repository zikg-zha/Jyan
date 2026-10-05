#!/usr/bin/env bash
# 家宴 · 沙箱部署脚本
# 流程：环境检查 → 依赖安装 → 数据迁移与初始化 → 后台守护启动 → 等待 3 秒复检端口与 HTTP → 冒烟验证
# 约束：仅用于沙箱/开发环境，禁止部署到生产（JIAYAN_ENV=production 直接终止）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
ENVNAME="${JIAYAN_ENV:-sandbox}"
RUN_DIR="$ROOT/run"
LOG_FILE="$RUN_DIR/app.log"
PID_FILE="$RUN_DIR/app.pid"

log() { echo "[deploy] $*"; }
die() { echo "[deploy] 失败：$*" >&2; exit 1; }

# ---------- 0. 生产环境保护 ----------
case "$ENVNAME" in
  production|prod)
    die "检测到 JIAYAN_ENV=$ENVNAME，本脚本禁止部署到生产环境"
    ;;
esac
log "部署环境：$ENVNAME（非生产）"

# ---------- 1. 环境检查 ----------
command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js 18+"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 版本过低（当前 $(node -v)），需要 18+"
log "Node.js $(node -v)"

LAN_IP="$(node -e '
const os=require("os");
for (const l of Object.values(os.networkInterfaces())) {
  for (const n of l||[]) if (n.family==="IPv4" && !n.internal) { console.log(n.address); process.exit(0); }
}
console.log("127.0.0.1");
')"
log "沙箱内网 IP：$LAN_IP"

mkdir -p "$RUN_DIR" "$ROOT/data"

# ---------- 2. 停止旧实例（幂等重复部署） ----------
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    log "停止旧实例 pid=$OLD_PID"
    kill "$OLD_PID" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$OLD_PID" >/dev/null 2>&1 || break
      sleep 0.5
    done
    kill -0 "$OLD_PID" >/dev/null 2>&1 && kill -9 "$OLD_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE"
fi

# 端口仍被占用则终止，避免覆盖别人的服务
if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | grep -q ":$PORT "; then
  die "端口 $PORT 已被其他进程占用，请设置 PORT=<其他端口> 后重试"
fi

# ---------- 3. 依赖安装 ----------
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
  log "依赖已存在，跳过安装"
else
  log "安装依赖…"
  if [ -f package-lock.json ]; then
    npm ci --omit=optional >"$RUN_DIR/npm-install.log" 2>&1 \
      || npm install >"$RUN_DIR/npm-install.log" 2>&1 \
      || die "依赖安装失败，详见 run/npm-install.log"
  else
    npm install >"$RUN_DIR/npm-install.log" 2>&1 || die "依赖安装失败，详见 run/npm-install.log"
  fi
fi

# ---------- 4. 构建与数据迁移 ----------
log "同步前端静态依赖并自检…"
node scripts/build.js || die "构建自检未通过"

log "执行数据库迁移与演示数据初始化…"
node server/seed.js || die "数据初始化失败"

# ---------- 5. 后台守护启动 ----------
log "以后台守护方式启动服务（nohup，端口 $PORT）…"
PORT="$PORT" HOST="$HOST" nohup node server/index.js >>"$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" >"$PID_FILE"
disown "$APP_PID" 2>/dev/null || true
log "服务进程 pid=$APP_PID，日志 run/app.log"

# 等待端口就绪（最多 20 秒）
READY=0
for _ in $(seq 1 40); do
  if node -e "
const net=require('net');const s=net.connect($PORT,'127.0.0.1');
s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));
" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done
[ "$READY" = "1" ] || { tail -30 "$LOG_FILE" >&2; die "服务启动后端口 $PORT 未就绪"; }
log "端口 $PORT 首次监听检查通过"

# ---------- 6. 等待 3 秒后复检（确认进程持续存活） ----------
log "等待 3 秒后复检端口监听与 HTTP 可达性…"
sleep 3

kill -0 "$APP_PID" >/dev/null 2>&1 || { tail -30 "$LOG_FILE" >&2; die "3 秒后服务进程已退出"; }
log "进程存活复检通过 pid=$APP_PID"

if command -v ss >/dev/null 2>&1; then
  ss -lnt 2>/dev/null | grep -q ":$PORT " || die "3 秒后端口 $PORT 未处于监听状态"
  log "端口监听复检通过（ss）"
else
  node -e "
const net=require('net');const s=net.connect($PORT,'127.0.0.1');
s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));
" || die "3 秒后端口 $PORT 不可连接"
  log "端口连接复检通过"
fi

HEALTH_JSON="$(node -e "
fetch('http://127.0.0.1:$PORT/api/health')
  .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
  .then(t => { process.stdout.write(t); })
  .catch(e => { process.stderr.write(e.message); process.exit(1); });
")" || die "3 秒后健康检查不可达"
log "HTTP 健康检查复检通过：$HEALTH_JSON"

HOME_STATUS="$(node -e "
fetch('http://127.0.0.1:$PORT/')
  .then(r => { process.stdout.write(String(r.status)); })
  .catch(() => { process.stdout.write('0'); });
")"
[ "$HOME_STATUS" = "200" ] || die "首页 HTTP 状态异常：$HOME_STATUS"
log "首页 HTTP 可达复检通过（200）"

# ---------- 7. 核心流程冒烟验证 ----------
log "执行核心流程冒烟验证…"
node scripts/smoke.js "http://127.0.0.1:$PORT" || die "核心流程冒烟验证未通过"

# ---------- 8. 结果 ----------
log "部署完成"
log "访问地址：http://$LAN_IP:$PORT/"
log "健康检查：http://$LAN_IP:$PORT/api/health"
log "测试账号：妈妈 / 爸爸 / 哥哥 / 妹妹 / 爷爷，密码统一 123456"
log "进程管理：停止 kill \$(cat run/app.pid)，日志 tail -f run/app.log"
