import os
import importlib
from typing import Iterable, Type


def get_subclasses(base: Type, name: str, path: str) -> Iterable:
    """
    Returns all subclasses found of the given base

    Args:
        base: a base class to check against
        name: the base name of the module
        path: the path to check for subclasses
    """
    items = set()

    for filename in os.listdir(path):
        if filename.startswith("__"):
            continue

        module_name, _ = os.path.splitext(filename)
        full_name = f"{name}.{module_name}"
        _module = importlib.import_module(full_name)
        for attr_name in dir(_module):
            if attr_name.startswith("__"):
                continue

            attr = getattr(_module, attr_name)

            try:
                if not issubclass(attr, base):
                    continue
            except TypeError:
                continue

            if attr in items:
                continue

            items.add(attr)

            yield attr
