import datetime

# from django.contrib.postgres.fields import ArrayField
from django.db import models


class Project(models.Model):
    created_date = models.DateField(default=datetime.date.today)
    tagline = models.CharField(max_length=256, blank=True, default="")
    title = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        ordering = ["title"]
