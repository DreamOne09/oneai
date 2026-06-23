#!/usr/bin/env python3
"""Deprecated: use scripts/zeabur-cli.py redeploy --service-id approval"""
import subprocess, sys
sys.exit(subprocess.call([sys.executable, __file__.replace('zeabur-redeploy.py', 'zeabur-cli.py'), 'redeploy', '--service-id', 'approval']))
