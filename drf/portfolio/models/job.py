import datetime
from django.db import models


class Job(models.Model):
    fulltime = "fulltime"
    freelance = "freelance"
    contract = "contract"

    company = models.CharField(max_length=100, default="")
    company_url = models.CharField(max_length=100, default="")
    EMPLOYMENT_CHOICES = (
        (fulltime, "Full Time"),
        (freelance, "Free Lance"),
        (contract, "Contract"),
    )
    employment_type = models.CharField(
        max_length=100, choices=EMPLOYMENT_CHOICES, default=fulltime
    )
    end_date = models.DateField(blank=True)
    location = models.CharField(max_length=100, default="New York, NY")
    job_title = models.CharField(max_length=100, default="Front End Engineer")
    start_date = models.DateField(default=datetime.date.today)

    def __str__(self):
        return f"{self.company} | {self.employment_type}"

    class Meta:
        ordering = ["end_date"]
