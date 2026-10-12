# Worker 配置与 Nebius 准备

线程的执行者可通过模型选择器切换，也可通过线程命令的 `worker` 字段指定：

```json
{ "provider": "claudeAgent", "model": "claude-haiku-5-5" }
```

```json
{ "provider": "codex", "model": "gpt-6-luna" }
```

`provider` 是 Settings 中配置的 provider 实例 ID。`thread.create` 和 `thread.model-selection.set` 接受上述 worker 配置，服务端同步现有 `modelSelection` 和持久化 worker 字段；既有客户端继续使用 `modelSelection`。真实切换验收见 [结果](evidence/m1-worker-switch-results.json)。

## Nebius

Settings → Providers 中提供 **Nebius · OpenCode**。它默认关闭，并复用现有 OpenCode 1.x/2.x 运行时和协议适配器。禁用时不探测进程、不请求模型、不执行文本生成；即使已有密钥也保持关闭。启用但缺少 API key 时仍阻止推理。

启用后，模型选择器可以显示：

| 名称             | 模型 ID                                 |
| ---------------- | --------------------------------------- |
| Nemotron 3 Nano  | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` |
| Nemotron 3 Super | `nvidia/nemotron-3-super-120b-a12b`     |
| Nemotron 3 Ultra | `nvidia/Nemotron-3-Ultra-550b-a55b`     |

目录来自 [Nebius 官方 Nemotron cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/README.md)，不会为了显示模型而发送推理请求；具体账户可用性尚未验证。

运行 Nebius 时，在该 provider 的 API key 字段输入密钥并开启实例。服务端沿用 T3 的 secret store，普通 settings 文件不含该密钥，客户端收到脱敏值。OpenCode 配置通过 `{env:NEBIUS_API_KEY}` 引用运行时环境变量，不把真实密钥写进配置 JSON。M0/M1 验收未输入真实 Nebius 密钥、未启用本机 Nebius 实例。

## 本机启动

```sh
cd /Users/travis/Desktop/NVIDIA/t3code
export PATH="/Users/travis/Desktop/NVIDIA/.tools/node_modules/.bin:$PATH"
pnpm exec vp run dev --home-dir "$PWD/.t3"
```

当前验收前端为 `http://localhost:5733`。如需同时运行类型检查，可把 server 与 web 分开启动，以免文件监听打断任务：

```sh
# 终端一，源码 server，不启用文件监听
T3CODE_HOME="$PWD/.t3" T3CODE_PORT=13773 T3CODE_NO_BROWSER=1 \
  VITE_DEV_SERVER_URL=http://localhost:5733 node apps/server/src/bin.ts

# 终端二，web；由 Vite 代理 server
T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_PORT=13773 PORT=5733 \
  pnpm --dir apps/web exec vp dev
```

两条命令都在本仓库根目录运行，使用上面的本地工具 PATH。
