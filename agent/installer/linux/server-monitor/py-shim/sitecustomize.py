"""sitecustomize.py — auto-loaded by Python at startup if on PYTHONPATH.

The installer drops this into /usr/lib/cloudfuze-aigov/ and adds that path
to /etc/environment via PYTHONPATH. Every new Python process (system, venv,
conda — anything that respects PYTHONPATH) imports this before user code.

Activating the shim from here means the agent's `import transformers`
already has its `.generate` wrapped by the time it runs.
"""
try:
    import cloudfuze_aigov_shim   # noqa: F401  (import side-effect: activate())
except Exception:
    # Shim broken? Don't break the user's Python. Silent fallback.
    pass
