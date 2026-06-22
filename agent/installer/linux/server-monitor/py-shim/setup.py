"""Minimal setup.py so the shim is pip-installable.

   pip install /opt/cloudfuze/server-monitor/py-shim
"""
from setuptools import setup, find_packages

setup(
    name="cloudfuze-aigov-shim",
    version="0.1.0",
    description="CloudFuze AI Governance — Python in-process LLM call shim.",
    author="CloudFuze",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[],
)
