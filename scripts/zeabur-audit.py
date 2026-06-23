#!/usr/bin/env python3
"""Deprecated: use scripts/zeabur-cli.py audit"""
import subprocess, sys
sys.exit(subprocess.call([sys.executable, __file__.replace('zeabur-audit.py', 'zeabur-cli.py'), 'audit']))
