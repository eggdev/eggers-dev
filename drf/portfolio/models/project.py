import datetime
from django.db import models


class Project(models.Model):
    created_date = models.DateField(default=datetime.date.today)
    tagline = models.CharField(max_length=256, default="")
    technologies = models.JSONField(default=["react"])
    title = models.CharField(max_length=100, default="")

    class Meta:
        ordering = ["title"]
