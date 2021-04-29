import datetime

# from django.contrib.postgres.fields import ArrayField
from django.db import models


class Project(models.Model):
    created_date = models.DateField(default=datetime.date.today)
    technologies = models.JSONField(default=["react"])
    tagline = models.CharField(max_length=256, default="")
    title = models.CharField(max_length=100, default="")

    class Meta:
        ordering = ["title"]
