# 文件寄存柜分享 Worker

这是给**你自己**部署的 Cloudflare Worker 模板。御钥师不运营中心服务。对方打开的是你的短域名。

这份实现已经和御钥师 App 对齐，依据是 `app/src-tauri/src/locker/worker.rs` 与 `locker/mod.rs`。不要改 App 去迁就这里；两边的签名串、取件码哈希和登记 JSON 必须逐字节一致。

## 在御钥师里填什么

设置里的分享服务：

| 项 | 填什么 |
|---|---|
| Worker 地址 | `https://locker.你的域名`，不要末尾斜杠 |
| 共享密钥 | 和 `wrangler secret put LOCKER_HMAC_SECRET` 是同一串。不要首尾空格或换行。Worker 比对前会去掉首尾空白 |

没配这两项时，寄存和自取仍然可用，只是不能生成分享链接。

## 部署

在本目录执行。不要把密钥写进 `wrangler.toml`。

```powershell
npx wrangler d1 create file-locker
```

把输出的 `database_id` 填进 `wrangler.toml`。

```powershell
npx wrangler d1 migrations apply file-locker --remote
npx wrangler r2 bucket create file-locker
npx wrangler secret put LOCKER_HMAC_SECRET
npx wrangler deploy
```

然后在 Cloudflare 把短域名（例如 `locker.example.com`）绑到这个 Worker。Cron 已写成每分钟一次，用来删掉过期或次数用尽的对象。

本地：

```powershell
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply file-locker --local
npm run dev
```

`.dev.vars` 里的 `LOCKER_HMAC_SECRET` 只给 `wrangler dev` 用。密钥至少 16 个字符，建议 `openssl rand -base64 32`。

本地不会自动每分钟跑 Cron。过期清扫的行为由 `npm test` 覆盖；线上由 `wrangler.toml` 的 cron 触发。

## 鉴权（登记和吊销）

`POST /register` 和 `DELETE /register/<slug>` 用共享密钥做 HMAC-SHA256。密钥是共享密钥的 UTF-8 字节。签名是小写 hex。

规范串，没有额外前缀：

```text
{unix秒时间戳}
{nonce小写hex}
{METHOD}
{path}
{body的SHA-256小写hex}
```

- `METHOD` 是大写，App 传 `POST` 或 `DELETE`。
- `path` 只含 URL 路径，例如 `/register`、`/register/<slug>`。不含主机名，不含 query。
- nonce 是 16 字节随机数的小写 hex，共 32 个字符。
- DELETE 的 body 为空，哈希的是空字节串。
- 请求头：`X-Locker-Timestamp`、`X-Locker-Nonce`、`X-Locker-Signature`。
- 时间戳和 Worker 时钟相差超过 300 秒则拒绝。

slug 已存在时返回 HTTP 409，App 会换一个 slug 再登记。

## 取件码哈希

与共享密钥无关。HMAC-SHA256 的密钥是公开字节 `gam-locker-code-v1`（App 里的 `LABEL_LOCKER_CODE`），消息是 6 位数字的 UTF-8，输出小写 hex。不要加 `locker-pickup-v1` 之类的前缀。

`482193` 的哈希：

```text
8e9eaf8aca0e5ca697acf681978ca4699ff7d3606647b5f6d8bcf5549574a3ca
```

下载页把用户输入的 6 位码 POST 到 `/api/<slug>`，Worker 用同一算法和 D1 里的 `code_hash` 比对。日志不记取件码明文，也不记内容密钥。

## 登记 JSON

`POST /register` 的字段是 snake_case：

```json
{
  "slug": "aB3dE6gH9k",
  "object_key": "你的同步前缀/locker/对象名hmac",
  "code_hash": "64位小写hex",
  "size": 1234,
  "expire_at": "2026-10-17T00:00:00Z",
  "max_pulls": 1,
  "pulls_left": 1
}
```

`expire_at`、`max_pulls`、`pulls_left` 可以是 `null`，表示永久或不限次数。`object_key` 是桶里的完整对象键，带上你在云同步里配置的前缀，后面是 `locker/<hmac>`。登记前对象必须已经在绑定的 R2 桶里，且字节数等于 `size`。单文件密文上限 100 MB。

`slug` 必须是 App 生成的 10 字符 base62，Worker 不自增编号。

## 取件

`POST /api/<slug>`，JSON `{"code":"482193"}`。校验未过期、未锁定、剩余次数大于 0、哈希匹配后，原子递减，再流式返回密文。

响应头：

- `X-Locker-Pulls-Left`：剩余次数。不限次数时不送这个头。
- `X-Locker-Burned`：`1` 表示这次之后已经焚毁。

归零则删除 R2 对象并删掉 D1 行。连续错误 5 次锁定 15 分钟（HTTP 423）。累计错误 20 次把分享标为吊销，`GET /d/<slug>` 和 `POST /api/<slug>` 返回 404；这时 R2 对象还在，等过期、次数归零，或 App 调用 `DELETE /register/<slug>` 再删。

## 下载页和密文帧

`GET /d/<slug>` 由这个 Worker 直接返回极简页面，不必再单独建 Pages。页面从 `location.hash` 读取内容密钥，不会把 hash 发给服务器。

v1 不做 HKDF。解密密钥就是 fragment 里的 32 字节 CK。

帧格式与文件保险库 `store/blob.rs` 的 `GKB1` 一致：

```text
magic(4 = "GKB1") || version(1 = 1) || chunk_size(u32 小端)
重复：nonce(24) || XChaCha20-Poly1305(明文块, AAD = 块序号 u64 小端)
```

密文自带 16 字节 tag。除最后一块外，每块明文长度等于 `chunk_size`。`chunk_size` 在 1 到 8 MiB 之间，App 使用 1 MiB。

浏览器 WebCrypto 没有 XChaCha20-Poly1305，下载页在本地用 `@noble/ciphers` 解密，密钥不离开浏览器。

fragment 写法：`#<ck>`，ck 为 32 字节的无填充 base64url，或 64 位十六进制。可选文件名：`#<ck>.<文件名的 base64url>`，文件名也不会发给服务器。

## 目录

```text
wrangler.toml
migrations/0001_locker.sql
src/index.ts          Worker 入口
src/handle.ts         路由、D1、R2、Cron
src/auth.ts           与 App 一致的 HMAC
src/frame.ts          GKB1 解密
src/download-client.ts
src/page.ts
test/                 node:test
```

D1 表 `locker` 的主键是 `slug`。另外有 `fail_streak` 和 `locked_until`，用来记住连续错误和 15 分钟锁定。

## 测试

```powershell
npm test
```

覆盖鉴权失败、取件码哈希与 App 向量、累计 20 次吊销、次数归零删除、过期拒绝，以及 GKB1 帧。