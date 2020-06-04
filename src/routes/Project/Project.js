import React, { useEffect, useState } from "react";
import { useRouteMatch, useHistory } from "react-router-dom";
import { makeStyles } from "@material-ui/core/styles";
import useFetch from "../../hooks/useFetch";
import { Language, GitHub } from "@material-ui/icons";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import Card from "@material-ui/core/Card";
import CardHeader from "@material-ui/core/CardHeader";
import CardContent from "@material-ui/core/CardContent";
import CardActions from "@material-ui/core/CardActions";
import Slide from "@material-ui/core/Slide";

import DeviceContainers from "../../components/DeviceContainers/DeviceContainers";

const useStyles = makeStyles((theme) => ({
  cardContent: {
    overflowY: "auto"
  },
}));

const Transition = React.forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

const Project = () => {
  const { cardContent } = useStyles();
  const routeMatch = useRouteMatch("/portfolio/:id");
  const history = useHistory();
  const [projectId, setProjectId] = useState(routeMatch.params.id);

  const [{ data: project, isLoading, isError, errorData }] = useFetch(
    `projects/${projectId}`
  );

  const { title, description, desktop_image, web_url, github } = project;

  const closeProjectDialog = () => {
    history.push(`/portfolio`);
  };

  useEffect(() => {
    setProjectId(routeMatch ? routeMatch.params.id : "");
  }, [routeMatch]);

  return (
    <Dialog
      maxWidth="md"
      fullWidth
      open={routeMatch ? routeMatch.isExact : false}
      onClose={closeProjectDialog}
      TransitionComponent={Transition}
      keepMounted
    >
      <Card>
        <CardHeader title={title} subheader={description} />
        <CardContent className={cardContent}>
          <DeviceContainers projectDetails={project} />
        </CardContent>
        <CardActions>
          {web_url && (
            <Button
              size="small"
              variant="contained"
              href={web_url}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<Language />}
            >
              Web
            </Button>
          )}
          {github &&
            github.map((link, index) => (
              <Button
                key={`${index}_link`}
                size="small"
                variant="contained"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<GitHub />}
              >
                {link.stack_type.replace(/_/g, " ")}
              </Button>
            ))}
        </CardActions>
      </Card>
    </Dialog>
  );
};

export default Project;
