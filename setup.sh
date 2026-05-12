#!/bin/bash
#!/bin/bash
################################################################################
# setup.sh - Автоматизация среды для vLLM на NVIDIA P104-100 (Pascal, 8GB VRAM)
# Оптимизировано для Ubuntu 24.04 + CUDA 12.x + Qwen 3.5 4B
################################################################################

set -e

echo "========================================"
echo "  vLLM Setup для Pascal P104-100"
echo "========================================"

# Цвета для输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

################################################################################
# ЭТАП 1: Проверка NVIDIA драйверов и CUDA
################################################################################

log_info "Проверка NVIDIA драйверов..."

if ! command -v nvidia-smi &> /dev/null; then
    log_error "nvidia-smi не найден. Установите драйвер NVIDIA."
    exit 1
fi

DRIVER_VERSION=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)
CUDA_VERSION=$(nvidia-smi --query-gpu=cuda_version --format=csv,noheader | head -1)
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
VRAM_TOTAL=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader | head -1)

log_info "Драйвер: $DRIVER_VERSION"
log_info "CUDA: $CUDA_VERSION"
log_info "GPU: $GPU_NAME"
log_info "VRAM: $VRAM_TOTAL"

# Проверка минимальной версии CUDA (рекомендуется 11.8+ для vLLM)
CUDA_MAJOR=$(echo $CUDA_VERSION | cut -d'.' -f1)
CUDA_MINOR=$(echo $CUDA_VERSION | cut -d'.' -f2)
if [ "$CUDA_MAJOR" -lt 11 ] || ([ "$CUDA_MAJOR" -eq 11 ] && [ "$CUDA_MINOR" -lt 8 ]); then
    log_warn "Рекомендуется CUDA 11.8+. Текущая: $CUDA_VERSION"
fi

# Проверка compute capability (для Pascal это 6.1)
COMPUTE_CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1)
log_info "Compute Capability: $COMPUTE_CAP"

if [ "$COMPUTE_CAP" != "6.1" ]; then
    log_warn "Ожидалось CC 6.1 для P104-100. Обнаружено: $COMPUTE_CAP"
fi

################################################################################
# ЭТАП 2: Проверка Python и создание venv
################################################################################

log_info "Настройка Python..."

if ! command -v python3 &> /dev/null; then
    log_error "Python 3 не найден."
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
log_info "Python: $PYTHON_VERSION"

# Создание виртуального окружения
VENV_DIR="$HOME/gailery/venv_vllm"

if [ -d "$VENV_DIR" ]; then
    log_warn "venv уже существует: $VENV_DIR"
    read -p "Удалить и пересоздать? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$VENV_DIR"
    else
        log_info "Использую существующий venv."
        source "$VENV_DIR/bin/activate"
    fi
fi

if [ ! -d "$VENV_DIR" ]; then
    log_info "Создание venv: $VENV_DIR"
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

# Обновлени�� pip
log_info "Обновление pip..."
python3 -m pip install --upgrade pip wheel setuptools

################################################################################
# ЭТАП 3: Установка PyTorch с поддержкой CUDA
################################################################################

log_info "Установка PyTorch (CUDA $CUDA_VERSION)..."

# Определяем версию CUDA для PyTorch
TORCH_CUDA_VERSION="12.1"
if [ "$CUDA_MAJOR" -ge 12 ]; then
    TORCH_CUDA_VERSION="12.4"
elif [ "$CUDA_MAJOR" -ge 11 ]; then
    TORCH_CUDA_VERSION="11.8"
fi

# Установка PyTorch
# Важно: для Pascal (CC 6.1) используем CUDA 12.1/12.4 compatible build
python3 -m pip install \
    torch==2.5.1 \
    torchvision==0.20.1 \
    torchaudio==2.5.1 \
    --index-url https://download.pytorch.org/whl/cu${TORCH_CUDA_VERSION//.} \
    --quiet

log_info "PyTorch установлен $(python3 -c 'import torch; print(torch.__version__)')"

################################################################################
# ЭТАП 4: Установка vLLM
################################################################################

log_info "Установка vLLM..."

# Проверяем, поддерживается ли Pascal бинарниками vLLM
# vLLM 0.6.3+ имеет лучшую поддержку старых GPU
python3 -m pip install vllm==0.6.3.post1 --quiet

log_info "vLLM установлен $(python3 -c 'import vllm; print(vllm.__version__)')"

# Установка дополнительных зависимостей
python3 -m pip install pillow transformers huggingface_hub --quiet

################################################################################
# ЭТАП 5: Оптимизация переменных окружения для Pascal
################################################################################

log_info "Настройка переменных окружения для Pascal..."

# Создаем файл окружения
ENV_FILE="$HOME/gailery/vllm_env.sh"

cat > "$ENV_FILE" << 'EOF'
# Оптимизации для NVIDIA P104-100 (Pascal, CC 6.1, 8GB VRAM)
# Добавьте в ~/.bashrc: source $HOME/gailery/vllm_env.sh

# Основные CUDA настройки
export CUDA_VISIBLE_DEVICES=0

# Оптимизация NCCL для Pascal
# Отключаем Peer-to-Peer для старых GPU если есть проблемы
export NCCL_P2P_DISABLE=0
export NCCL_IB_DISABLE=1
export NCCL_NET_GDR_LEVEL=0

# Для vLLM: ограничиваем память GPU
# P104-100: 8GB VRAM, рекомендуется 85% для модели + KV cache
export VLLM_GPU_MEMORY_utilization=0.85
export PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb=512

# Float16 вместо bfloat16 (Pascal не поддерживает bfloat16 эффективно)
# bfloat16 доступен, но работает через программную эмуляцию
export TORCH_FLOAT32_ALT_FP32=0

# Отладочные переменные (опционально)
# export TORCH_CUDA_ARCH_LIST="6.1"
# export VLLM_LOGGING_LEVEL=INFO
EOF

log_info "Файл окружения создан: $ENV_FILE"
log_info "Для активации выполните: source $ENV_FILE"

################################################################################
# ЭТАП 6: Проверка работоспособности
################################################################################

log_info "Проверка CUDA в PyTorch..."

python3 -c "
import torch
print(f'  PyTorch: {torch.__version__}')
print(f'  CUDA Available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'  CUDA Device: {torch.cuda.get_device_name(0)}')
    print(f'  CUDA Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB')
    print(f'  Compute Capability: {torch.cuda.get_device_capability(0)}')
"

log_info "Проверка vLLM..."

python3 -c "
import vllm
print(f'  vLLM: {vllm.__version__}')
"

################################################################################
# Итог
################################################################################

echo ""
echo "========================================"
echo -e "${GREEN}Настройка завершена!${NC}"
echo "========================================"
echo ""
echo "Активировать окружение:"
echo "  source $HOME/gailery/venv_vllm/bin/activate"
echo ""
echo "Загрузить переменные:"
echo "  source $HOME/gailery/vllm_env.sh"
echo ""
echo "Далее запустите:"
echo "  python check_gpu.py"
echo ""