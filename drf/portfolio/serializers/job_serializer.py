from portfolio.models import Job
from rest_framework import serializers


class JobSerializer(serializers.ModelSerializer):
    class Meta:
        model = Job
        fields = [
            "company",
            "company_url",
            "employment_type",
            "end_date",
            "location",
            "job_title",
            "start_date",
        ]
