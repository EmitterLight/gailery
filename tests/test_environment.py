"""Tests that the runtime environment has correct dependency versions.

P104-100 (Pascal SM 6.1) constraints:
- onnxruntime-gpu 1.18.0 + cuDNN 8.x — единственная работающая комбинация
- numpy < 2 — onnxruntime 1.18.0 собран с numpy 1.x API
- opencv < 4.11 — совместим с numpy < 2
"""

import pkg_resources


REQUIRED_VERSIONS = {
    "onnxruntime-gpu": "==1.18.0",
    "numpy": "<2",
    "opencv-python": "<4.11",
    "opencv-python-headless": "<4.11",
}


def _check_version(name, spec):
    try:
        dist = pkg_resources.get_distribution(name)
        version = dist.version
    except pkg_resources.DistributionNotFound:
        pytest.fail(f"Пакет {name} не установлен")

    parsed_specs = list(pkg_resources.parse_requirements(f"x{spec}"))
    if not parsed_specs:
        return
    specifier = parsed_specs[0].specifier
    parsed_version = pkg_resources.parse_version(version)
    if parsed_version not in specifier:
        pytest.fail(
            f"{name}: требуется {spec}, установлена {version}"
        )


def test_numpy_below_2():
    _check_version("numpy", "<2")


def test_onnxruntime_gpu_pinned():
    _check_version("onnxruntime-gpu", "==1.18.0")


def test_opencv_python_below_4_11():
    _check_version("opencv-python", "<4.11")


def test_opencv_headless_below_4_11():
    _check_version("opencv-python-headless", "<4.11")


def test_insightface_importable():
    from insightface.app import FaceAnalysis
    assert FaceAnalysis is not None


def test_all_dependencies_list():
    errors = []
    for name, spec in REQUIRED_VERSIONS.items():
        try:
            dist = pkg_resources.get_distribution(name)
            version = dist.version
        except pkg_resources.DistributionNotFound:
            errors.append(f"{name}: не установлен")
            continue
        parsed_specs = list(pkg_resources.parse_requirements(f"x{spec}"))
        if parsed_specs:
            specifier = parsed_specs[0].specifier
            if pkg_resources.parse_version(version) not in specifier:
                errors.append(f"{name}: нужно {spec}, стоит {version}")
    if errors:
        pytest.fail(
            "Нарушены версии зависимостей:\n" + "\n".join(errors)
            + "\n\nP104-100 Pascal SM 6.1 не поддерживает cuDNN 9.x. "
            "onnxruntime>1.18 требует cuDNN 9. numpy>=2 ломает onnxruntime 1.18."
        )