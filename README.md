# 企业微信 ChatGPT Plus / Codex 机器人

这是一个 Node.js 企业微信机器人桥接服务。它通过企业微信智能机器人的 WebSocket 长连接接收消息，再通过 OpenAI Codex SDK 和本机保存的 ChatGPT 登录状态生成回答。

本项目不需要 OpenAI API Key，也不调用按量付费的 OpenAI Platform API。请求会计入当前 ChatGPT 订阅可用的 Codex 使用额度。它依赖本机的 ChatGPT 登录状态，因此适合个人使用、内部试验或受控环境，不适合作为面向大量用户的生产 API 替代方案。

## 安全默认值

- Codex 线程使用只读沙箱。
- 禁止命令审批、网络访问和网页搜索。
- Codex 只在隔离的 `.codex-bot-runtime` 目录中运行。
- 企业微信凭证只保存在 `.env`，该文件已被 Git 忽略。
- 每个企业微信单聊或群聊使用独立的内存会话；服务重启后会话上下文清空。

## 前置条件

1. 安装 Node.js 20 或更高版本。
2. 拥有包含 Codex 使用权限的 ChatGPT 订阅。
3. 安装 Codex CLI：

   ```powershell
   npm.cmd install -g @openai/codex
   ```

4. 使用 ChatGPT 账户登录：

   ```powershell
   codex.cmd login
   codex.cmd login status
   ```

   如果机器没有方便使用的浏览器，可运行 `codex.cmd login --device-auth`。

## 企业微信配置

1. 使用企业微信管理员账号进入管理后台。
2. 进入「安全与管理」→「管理工具」→「智能机器人」。
3. 创建机器人，选择「API 模式创建」和「使用长连接」。
4. 获取机器人 ID 和 Secret，并写入本地 `.env`。
5. 将机器人配置到允许使用的成员或群聊范围；群聊中通常需要添加机器人并 `@` 它。

本项目使用长连接，不需要公网域名、回调 URL、Token 或 EncodingAESKey。

## 安装与配置

项目目录：

```text
C:\Users\samnever\wecom-bot
```

安装依赖：

```powershell
cd C:\Users\samnever\wecom-bot
npm.cmd install
```

首次配置时可复制模板：

```powershell
Copy-Item .env.example .env
```

`.env` 的必需配置：

```dotenv
WECOM_BOT_ID=企业微信机器人 ID
WECOM_BOT_SECRET=企业微信机器人 Secret
```

可选配置：

```dotenv
# Luna + low 优先降低企业微信聊天延迟
CODEX_MODEL=gpt-6-luna
CODEX_REASONING_EFFORT=low
CODEX_WORKING_DIRECTORY=.codex-bot-runtime
CODEX_MAX_CONVERSATIONS=100
BOT_INSTRUCTIONS=你是企业微信中的内部 AI 助手。回答准确、简洁，并在不确定时明确说明。不要执行命令、修改文件或访问网络，只回答用户的问题。
```

私有化部署的企业微信如果提供了专用 WebSocket 地址，可额外设置 `WECOM_WS_URL`。

## 启动

先确认 ChatGPT 登录状态：

```powershell
npm.cmd run auth:status
```

再启动机器人：

```powershell
npm.cmd start
```

看到“机器人已连接”后，在企业微信中向机器人发送文字，或在群聊中 `@` 机器人。模型生成期间，答案会逐步更新，而不是等待完整回答后才显示。请保持这个 Node.js 进程持续运行；关闭终端或进程后，机器人就无法回复。

## 验证代码

```powershell
npm.cmd test
npm.cmd run check
```

## 部署建议

- 在一台长期在线且已完成 `codex login` 的受控机器上运行。
- 使用 Windows 服务、任务计划程序或进程守护工具维持进程。
- 限制企业微信机器人的可用范围，并设置合理的成员白名单和调用频率。
- 不要提交 `.env`、Codex 登录缓存或任何 Secret。
- ChatGPT 订阅的 Codex 使用存在速率和用量限制；它不是 OpenAI API 的正式生产替代品。
- 当前会话只保存在内存中；多实例部署或持久化上下文需要另行接入数据库。

## 常见问题

### 机器人提示认证失败

确认企业微信机器人使用的是「API 模式 / 长连接」，并重新复制机器人 ID 与 Secret。回调模式的 Token 和 EncodingAESKey 不适用于本项目。

### Codex 提示未登录

在运行机器人的同一个 Windows 用户下执行 `codex.cmd login`。登录缓存与 Windows 用户关联。

### 群聊没有响应

确认机器人已被添加到该群、可用范围包含相关成员，并在消息中 `@` 机器人；同时检查 Node.js 进程是否显示已连接。

### 回复突然失败或变慢

检查 ChatGPT/Codex 使用额度、网络连接和终端日志。达到订阅用量限制后，需要等待额度窗口恢复。

## 项目结构

```text
src/index.js       企业微信长连接与消息处理
src/config.js      环境变量读取与校验
src/message.js     消息提取、会话标识、去重和截断
src/codex.js       Codex SDK 会话与回答生成
test/              单元测试
.env.example       配置模板（不含真实凭证）
README.md          使用说明
```

## 相关文档

- [OpenAI Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [OpenAI Codex 登录与认证](https://learn.chatgpt.com/docs/auth)
- [企业微信智能机器人 Node.js SDK](https://github.com/WecomTeam/aibot-node-sdk)
