"""
Views package initialization

The snippet of code below will traverse this package directory looking for view classes to automatically import
and place in the package's scope.  This eliminates the need to manually import each class created in this file.
"""
import os

from rest_framework import viewsets

from app.utils import get_subclasses

__locals = locals()
for viewset in get_subclasses(
    viewsets.GenericViewSet, __name__, os.path.dirname(__file__)
):
    # TODO: there has to be a better way to get the name of the viewset
    name = str(viewset).split("'")[1].rsplit(".", 1)[-1]
    __locals[name] = viewset
