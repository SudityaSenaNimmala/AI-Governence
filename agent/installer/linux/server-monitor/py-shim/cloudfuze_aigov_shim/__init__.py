"""CloudFuze AI Governance — Python in-process shim (Tier 3 L4).

Wraps common LLM libraries so their `.generate()` / `.chat()` calls get reported
to the local server-monitor daemon. Designed to be **safe to import** — if the
target library isn't installed, that wrapper is silently skipped. If the daemon
isn't running, calls go through unwrapped after one quick failure.

Currently shims:
    transformers.PreTrainedModel.generate
    llama_cpp.Llama.__call__ / create_completion / create_chat_completion
    openai (1.x SDK)              — Anthropic/OpenAI cloud calls through the
    anthropic                     —   Python SDK that bypass HTTPS_PROXY (rare
                                      but possible with custom http transports)

How to activate:

    Option A (project-wide, no code edits) — set in /etc/environment:
        PYTHONSTARTUP=/usr/lib/cloudfuze-aigov/sitecustomize.py
    or:
        export PYTHONPATH=/usr/lib/cloudfuze-aigov:$PYTHONPATH
    and drop `sitecustomize.py` into /usr/lib/cloudfuze-aigov/.

    Option B (per-agent):
        import cloudfuze_aigov_shim
        cloudfuze_aigov_shim.activate()

    Option C (zero touch on the agent — recommended):
        Install this package into the site-packages used by every agent
        (system python or each venv). The shim auto-activates on import
        via _autoload_marker below.
"""

from __future__ import annotations

import json
import os
import sys
import time
import threading
from urllib import request as _urlrequest

__version__ = "0.1.0"

INGEST_URL = os.environ.get(
    "CLOUDFUZE_SHIM_INGEST", "http://127.0.0.1:8744/v1/in-process"
)
TIMEOUT_S  = 1.5
DEBUG      = os.environ.get("CLOUDFUZE_SHIM_DEBUG") == "1"

_activated = False
_lock = threading.Lock()


def activate():
    """Idempotent. Patches every supported library that's importable."""
    global _activated
    with _lock:
        if _activated:
            return
        _activated = True
    _patch_transformers()
    _patch_llama_cpp()
    _patch_openai_sdk()
    _patch_anthropic_sdk()
    if DEBUG:
        print("[cloudfuze-shim] activated", file=sys.stderr)


# ---- Reporting ----------------------------------------------------------------

def _post(event: dict) -> None:
    """Fire-and-forget POST to the local daemon. Never raises."""
    try:
        body = json.dumps(event).encode("utf-8")
        req = _urlrequest.Request(
            INGEST_URL, data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        # Run synchronously but with a short timeout. The daemon listens on
        # loopback so 1.5s is overkill; if anything is wrong we don't want to
        # slow the agent.
        with _urlrequest.urlopen(req, timeout=TIMEOUT_S):
            pass
    except Exception as err:        # noqa: BLE001
        if DEBUG:
            print(f"[cloudfuze-shim] post failed: {err}", file=sys.stderr)


def _report(*, provider: str, model, prompt_text, response_text,
            prompt_tokens=0, completion_tokens=0,
            duration_ms=None, endpoint=None) -> None:
    event = {
        "occurred_at": _iso_now(),
        "duration_ms": duration_ms,
        "provider": provider,
        "model": str(model) if model is not None else None,
        "prompt_text": _stringify(prompt_text),
        "response_text": _stringify(response_text),
        "prompt_tokens": int(prompt_tokens or 0),
        "completion_tokens": int(completion_tokens or 0),
        "pid": os.getpid(),
        "endpoint": endpoint,
    }
    # Reporting happens on a background thread so a slow daemon never blocks
    # the agent's generate() call.
    threading.Thread(target=_post, args=(event,), daemon=True).start()


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def _stringify(x) -> str | None:
    if x is None:
        return None
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        # ChatCompletion-style message list.
        try:
            return "\n".join(
                f"[{m.get('role', 'user')}] {m.get('content', '')}"
                for m in x if isinstance(m, dict)
            )
        except Exception:
            pass
    try:
        return json.dumps(x, default=str)[:50000]
    except Exception:
        return str(x)[:50000]


# ---- transformers -------------------------------------------------------------

def _patch_transformers() -> None:
    try:
        import transformers   # type: ignore
        from transformers import PreTrainedModel  # type: ignore
    except Exception:
        return
    if getattr(PreTrainedModel.generate, "_cloudfuze_patched", False):
        return
    original_generate = PreTrainedModel.generate

    def generate(self, *args, **kwargs):
        t0 = time.monotonic()
        prompt = _extract_transformers_prompt(self, args, kwargs)
        output = original_generate(self, *args, **kwargs)
        try:
            response = _extract_transformers_response(self, output)
            n_in  = _extract_transformers_input_tokens(self, args, kwargs)
            n_out = _extract_transformers_output_tokens(self, output, n_in)
            model_name = getattr(getattr(self, "config", None), "_name_or_path", None) or type(self).__name__
            _report(
                provider="local-python-transformers",
                model=model_name,
                prompt_text=prompt,
                response_text=response,
                prompt_tokens=n_in,
                completion_tokens=n_out,
                duration_ms=int((time.monotonic() - t0) * 1000),
                endpoint="transformers.generate",
            )
        except Exception as err:        # noqa: BLE001
            if DEBUG:
                print(f"[cloudfuze-shim] transformers report failed: {err}", file=sys.stderr)
        return output

    generate._cloudfuze_patched = True  # type: ignore[attr-defined]
    PreTrainedModel.generate = generate


def _extract_transformers_prompt(self, args, kwargs):
    # transformers .generate is called with input_ids tensor; decode through
    # the model's tokenizer if available on the model object.
    try:
        tok = getattr(self, "tokenizer", None)
        ids = kwargs.get("input_ids")
        if ids is None and args:
            ids = args[0]
        if ids is None or tok is None:
            return None
        return tok.decode(ids[0], skip_special_tokens=True)
    except Exception:
        return None


def _extract_transformers_response(self, output):
    try:
        tok = getattr(self, "tokenizer", None)
        if tok is None or output is None:
            return None
        # output may be a tensor of shape [batch, seq] or a Generation object.
        ids = output[0] if hasattr(output, "__getitem__") else None
        if ids is None:
            return None
        return tok.decode(ids, skip_special_tokens=True)
    except Exception:
        return None


def _extract_transformers_input_tokens(self, args, kwargs):
    try:
        ids = kwargs.get("input_ids")
        if ids is None and args:
            ids = args[0]
        return int(ids.shape[-1])
    except Exception:
        return 0


def _extract_transformers_output_tokens(self, output, n_in):
    try:
        return max(int(output.shape[-1]) - int(n_in or 0), 0)
    except Exception:
        return 0


# ---- llama_cpp ----------------------------------------------------------------

def _patch_llama_cpp() -> None:
    try:
        import llama_cpp   # type: ignore
        cls = llama_cpp.Llama
    except Exception:
        return
    for method_name in ("__call__", "create_completion", "create_chat_completion"):
        original = getattr(cls, method_name, None)
        if original is None or getattr(original, "_cloudfuze_patched", False):
            continue

        def make_wrapper(orig, name):
            def wrapper(self, *args, **kwargs):
                t0 = time.monotonic()
                result = orig(self, *args, **kwargs)
                try:
                    prompt = args[0] if args else kwargs.get("prompt") or kwargs.get("messages")
                    response_text = _llama_response_text(result)
                    usage = (result or {}).get("usage", {}) if isinstance(result, dict) else {}
                    model = getattr(self, "model_path", None) or "llama.cpp-local"
                    _report(
                        provider="local-python-llamacpp",
                        model=model,
                        prompt_text=prompt,
                        response_text=response_text,
                        prompt_tokens=usage.get("prompt_tokens", 0),
                        completion_tokens=usage.get("completion_tokens", 0),
                        duration_ms=int((time.monotonic() - t0) * 1000),
                        endpoint=f"llama_cpp.Llama.{name}",
                    )
                except Exception as err:    # noqa: BLE001
                    if DEBUG:
                        print(f"[cloudfuze-shim] llama_cpp report failed: {err}", file=sys.stderr)
                return result
            wrapper._cloudfuze_patched = True   # type: ignore[attr-defined]
            return wrapper

        setattr(cls, method_name, make_wrapper(original, method_name))


def _llama_response_text(result):
    if not isinstance(result, dict):
        return None
    # chat: result["choices"][0]["message"]["content"]
    # completion: result["choices"][0]["text"]
    try:
        ch = result.get("choices", [])
        if not ch:
            return None
        c0 = ch[0]
        if "message" in c0:
            return c0["message"].get("content")
        return c0.get("text")
    except Exception:
        return None


# ---- openai (1.x SDK) ---------------------------------------------------------

def _patch_openai_sdk() -> None:
    """Wraps openai.resources.chat.completions.Completions.create.

    Cloud calls already go through HTTPS_PROXY, so this is mostly a backup for
    setups where the SDK is configured with a custom http_client that bypasses
    env vars.
    """
    try:
        from openai.resources.chat.completions import Completions   # type: ignore
    except Exception:
        return
    if getattr(Completions.create, "_cloudfuze_patched", False):
        return
    original = Completions.create

    def create(self, *args, **kwargs):
        t0 = time.monotonic()
        result = original(self, *args, **kwargs)
        try:
            messages = kwargs.get("messages") or (args[0] if args else None)
            model = kwargs.get("model")
            response_text = None
            usage = None
            try:
                response_text = result.choices[0].message.content
                usage = result.usage
            except Exception:
                pass
            _report(
                provider="openai-python-sdk",
                model=model,
                prompt_text=messages,
                response_text=response_text,
                prompt_tokens=getattr(usage, "prompt_tokens", 0) if usage else 0,
                completion_tokens=getattr(usage, "completion_tokens", 0) if usage else 0,
                duration_ms=int((time.monotonic() - t0) * 1000),
                endpoint="openai.chat.completions.create",
            )
        except Exception as err:    # noqa: BLE001
            if DEBUG:
                print(f"[cloudfuze-shim] openai report failed: {err}", file=sys.stderr)
        return result

    create._cloudfuze_patched = True    # type: ignore[attr-defined]
    Completions.create = create


# ---- anthropic SDK ------------------------------------------------------------

def _patch_anthropic_sdk() -> None:
    try:
        from anthropic.resources.messages import Messages    # type: ignore
    except Exception:
        return
    if getattr(Messages.create, "_cloudfuze_patched", False):
        return
    original = Messages.create

    def create(self, *args, **kwargs):
        t0 = time.monotonic()
        result = original(self, *args, **kwargs)
        try:
            model = kwargs.get("model")
            messages = kwargs.get("messages")
            response_text = None
            usage = None
            try:
                response_text = result.content[0].text
                usage = result.usage
            except Exception:
                pass
            _report(
                provider="anthropic-python-sdk",
                model=model,
                prompt_text=messages,
                response_text=response_text,
                prompt_tokens=getattr(usage, "input_tokens", 0) if usage else 0,
                completion_tokens=getattr(usage, "output_tokens", 0) if usage else 0,
                duration_ms=int((time.monotonic() - t0) * 1000),
                endpoint="anthropic.messages.create",
            )
        except Exception as err:    # noqa: BLE001
            if DEBUG:
                print(f"[cloudfuze-shim] anthropic report failed: {err}", file=sys.stderr)
        return result

    create._cloudfuze_patched = True    # type: ignore[attr-defined]
    Messages.create = create


# Auto-activate at import time if env var says so. Installer sets this in
# /etc/environment so every Python process inherits it.
if os.environ.get("CLOUDFUZE_SHIM_AUTOSTART", "1") != "0":
    try:
        activate()
    except Exception:
        # Never block a user import — the agent should keep working even if
        # the shim hits an unexpected library shape.
        pass
