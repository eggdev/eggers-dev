from rest_framework import viewsets, permissions
from portfolio.models import Project
from portfolio.serializers import ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """
    API endpoint that allows users to be viewed or edited.
    """

    queryset = Project.objects.all().order_by("-title")
    serializer_class = ProjectSerializer
    permission_classes = []
