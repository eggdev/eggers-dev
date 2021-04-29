from portfolio.models import Project
from rest_framework import serializers


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = [
            "created_date",
            "tagline",
            "title",
        ]
