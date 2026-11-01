"""An illustrative acceptance check, not a performance measurement."""


def within_launch_budget(seconds: float) -> bool:
    return seconds < 10
