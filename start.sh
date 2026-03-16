#!/bin/bash
source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null || true
export PATH="$HOME/.local/bin:$PATH"
cd "/home/silverion/projects/claude-code-hub"
./node_modules/electron/dist/electron . "$@"
