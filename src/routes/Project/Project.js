import React, { useEffect, useState } from "react";
import { useRouteMatch, useHistory } from "react-router-dom";
import { makeStyles } from "@material-ui/core/styles";
import useFetch from "../../hooks/useFetch";
import Language from "@material-ui/icons/Language";
import GitHub from "@material-ui/icons/GitHub";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import Typography from "@material-ui/core/Typography";
import Slide from "@material-ui/core/Slide";

import Technologies from "../../components/Technologies/Technologies";

const useStyles = makeStyles((theme) => ({
  dialogContainer: {
    padding: `${theme.spacing(4)}px 0`,
  },
  cardContent: {
    display: "flex",
    justifyContent: "center",
    flexWrap: "wrap",
  },
}));

const Transition = React.forwardRef(function Transition(props, ref) {
  return (
    <Slide direction="up" mountOnEnter unmountOnExit ref={ref} {...props} />
  );
});

const Project = () => {
  const { cardContent, dialogContainer } = useStyles();
  const routeMatch = useRouteMatch("/portfolio/:id");
  const history = useHistory();
  const [projectId, setProjectId] = useState(routeMatch.params.id);

  const [{ data: project }] = useFetch(`projects/${projectId}`);

  const {
    title,
    description,
    web_url,
    github,
    primary_technologies,
    secondary_technologies,
  } = project;

  const closeProjectDialog = () => {
    history.push(`/portfolio`);
  };

  useEffect(() => {
    setProjectId(routeMatch ? routeMatch.params.id : "");
  }, [routeMatch]);

  return (
    <Dialog
      maxWidth="sm"
      fullWidth
      open={projectId !== ""}
      onClose={closeProjectDialog}
      TransitionComponent={Transition}
      keepMounted
      PaperProps={{
        classes: {
          root: dialogContainer,
        },
      }}
    >
      <DialogTitle disableTypography={true}>
        <Typography variant="h4" align="center" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h6" align="center" wrap>
          {description}
        </Typography>
      </DialogTitle>
      <DialogContent className={cardContent}>
        <Technologies
          primary={primary_technologies}
          secondary={secondary_technologies}
        />
      </DialogContent>
      <DialogActions className={cardContent}>
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
      </DialogActions>
    </Dialog>
  );
};

export default Project;
