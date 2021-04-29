"""
Serializers package initialization

The snippet of code below will traverse this package directory looking for serializer classes to automatically import
and place in the package's scope.  This eliminates the need to manually import each class created in this file.
"""
import os

from rest_framework import serializers
from app.utils import get_subclasses

__locals = locals()
for serializer in get_subclasses(
    serializers.Serializer, __name__, os.path.dirname(__file__)
):
    name = str(serializer).split("'")[1].rsplit(".", 1)[-1]
    __locals[name] = name
