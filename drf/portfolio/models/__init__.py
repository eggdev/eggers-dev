"""
Models package initialization

The snippet of code below will traverse this package directory looking for model classes to automatically import
and place in the package's scope.  This eliminates the need to manually import each class created in this file.
"""
import os

from django.db import models

from app.utils import get_subclasses

__locals = locals()
for model in get_subclasses(models.Model, __name__, os.path.dirname(__file__)):
    __locals[model._meta.object_name] = model
