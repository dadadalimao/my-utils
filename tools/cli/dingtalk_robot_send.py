#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""钉钉自定义机器人发消息（加签）。

文档：https://open.dingtalk.com/document/robots/custom-robot-access

签名：HMAC-SHA256(secret, timestamp + \"\\n\" + secret) → Base64 → URL Encode，
再把 timestamp、sign 拼到 webhook 后 POST JSON。

配置优先级：命令行 > 同目录 `.env` > 下方代码内默认值。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent

# 代码内默认值（最低优先级，敏感信息请放 .env）
DINGTALK_WEBHOOK = ""
DINGTALK_SECRET = ""


def _load_env_file(path: Path) -> dict[str, str]:
    """读取 KEY=VALUE，不写入 os.environ。"""
    result: dict[str, str] = {}
    if not path.is_file():
        return result
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            result[key] = value
    return result


def _first_non_empty(*values: str | None) -> str:
    """按参数顺序取第一个非空值。"""
    for value in values:
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _resolve(cli_webhook: str | None = None, cli_secret: str | None = None) -> tuple[str, str]:
    """命令行 > .env > 代码内。"""
    env = _load_env_file(_SCRIPT_DIR / ".env")
    webhook = _first_non_empty(
        cli_webhook, env.get("DINGTALK_WEBHOOK"), DINGTALK_WEBHOOK
    )
    secret = _first_non_empty(
        cli_secret, env.get("DINGTALK_SECRET"), DINGTALK_SECRET
    )
    return webhook, secret


def build_signed_url(webhook: str, secret: str) -> str:
    """按官方算法生成带 timestamp、sign 的请求地址。"""
    timestamp = str(round(time.time() * 1000))
    secret_enc = secret.encode("utf-8")
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        secret_enc, string_to_sign.encode("utf-8"), digestmod=hashlib.sha256
    ).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
    sep = "&" if "?" in webhook else "?"
    return f"{webhook}{sep}timestamp={timestamp}&sign={sign}"


def send(
    payload: dict,
    webhook: str | None = None,
    secret: str | None = None,
    timeout: int = 10,
) -> dict:
    """POST 发送消息，返回钉钉 JSON 响应。"""
    webhook, secret = _resolve(cli_webhook=webhook, cli_secret=secret)
    if not webhook:
        raise ValueError("缺少 webhook：请传 --webhook、写入 .env 或填写代码内 DINGTALK_WEBHOOK")
    if not secret:
        raise ValueError("缺少 secret：请传 --secret、写入 .env 或填写代码内 DINGTALK_SECRET")

    url = build_signed_url(webhook, secret)
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def send_text(
    content: str,
    at_mobiles: list[str] | None = None,
    at_all: bool = False,
    webhook: str | None = None,
    secret: str | None = None,
) -> dict:
    """发送 text 消息，可选 @ 手机号或 @所有人。"""
    at: dict = {"isAtAll": at_all}
    if at_mobiles:
        at["atMobiles"] = at_mobiles
    return send(
        {
            "msgtype": "text",
            "text": {"content": content},
            "at": at,
        },
        webhook=webhook,
        secret=secret,
    )


def send_markdown(
    title: str,
    text: str,
    at_all: bool = False,
    webhook: str | None = None,
    secret: str | None = None,
) -> dict:
    """发送 markdown 消息。"""
    return send(
        {
            "msgtype": "markdown",
            "markdown": {"title": title, "text": text},
            "at": {"isAtAll": at_all},
        },
        webhook=webhook,
        secret=secret,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="钉钉自定义机器人发消息（加签）")
    parser.add_argument("content", nargs="?", default="hello from python", help="text 正文")
    parser.add_argument("--secret", default=None, help="加签密钥 SEC...（覆盖 .env）")
    parser.add_argument("--webhook", default=None, help="机器人 webhook（覆盖 .env）")
    parser.add_argument("--markdown", action="store_true", help="按 markdown 发送")
    parser.add_argument("--title", default="通知", help="markdown 标题")
    args = parser.parse_args()

    if args.markdown:
        result = send_markdown(
            args.title, args.content, webhook=args.webhook, secret=args.secret
        )
    else:
        result = send_text(args.content, webhook=args.webhook, secret=args.secret)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
