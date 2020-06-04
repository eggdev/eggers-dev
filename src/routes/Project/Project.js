import React, { useEffect, useState } from "react";
import { useRouteMatch, useHistory } from "react-router-dom";

import useFetch from "../../hooks/useFetch";

import Dialog from "@material-ui/core/Dialog";
import Slide from "@material-ui/core/Slide";

const Transition = React.forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

const Project = () => {
  const routeMatch = useRouteMatch("/portfolio/:id");
  const history = useHistory();
  const [projectId, setProjectId] = useState(routeMatch.params.id);

  const [{ data, isLoading, isError, errorData }] = useFetch(
    `projects/${projectId}`
  );

  const closeProjectDialog = () => {
    history.push(`/portfolio`);
  };

  useEffect(() => {
    setProjectId(routeMatch ? routeMatch.params.id : "");
  }, [routeMatch]);

  console.log(data);
  return (
    <Dialog
      open={routeMatch ? routeMatch.isExact : false}
      onClose={closeProjectDialog}
      TransitionComponent={Transition}
      keepMounted
    >
      <h1>Hello</h1>
    </Dialog>
  );
};

export default Project;
