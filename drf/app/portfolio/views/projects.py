from rest_framework import viewsets, permissions
from app.portfolio.models.projects import Project
from app.portfolio.serializers.projects import ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """
    API endpoint that allows users to be viewed or edited.
    """

    queryset = Project.objects.all().order_by("-title")
    serializer_class = ProjectSerializer
    permission_classes = []
