from app.portfolio.models import projects
from rest_framework import serializers


class ProjectSerializer(serializers.HyperlinkedModelSerializer):
    class Meta:
        model = projects.Project
        fields = ["title"]
