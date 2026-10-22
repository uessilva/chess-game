import pytest

torch = pytest.importorskip(
    "torch", reason="torch is an optional train-group dependency"
)


def test_torch_cpu_smoke() -> None:
    left = torch.tensor([1.0, 2.0])
    right = torch.tensor([3.0, 4.0])
    assert left.device.type == "cpu"
    assert (left @ right).item() == 11.0
