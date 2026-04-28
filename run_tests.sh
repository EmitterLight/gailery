#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

VENV=/opt/gailray/venv/bin/python3
FLAGS="-v --tb=short -q"

echo "═══════════════════════════════════════"
echo "  Gailery Test Runner"
echo "═══════════════════════════════════════"
echo ""

$VENV -m pytest tests/ $FLAGS "$@"

RC=$?

echo ""
if [ $RC -eq 0 ]; then
    echo "✅ Все тесты пройдены"
else
    echo "❌ Есть падающие тесты (код $RC)"
fi
echo "═══════════════════════════════════════"

exit $RC
