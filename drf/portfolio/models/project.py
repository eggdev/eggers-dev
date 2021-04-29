from django.db import models


class Project(models.Model):
    title = models.CharField(max_length=100, blank=True, default="")
    created_date = models.DateField()

    class Meta:
        ordering = ["title"]
