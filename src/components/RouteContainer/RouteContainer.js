import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { Box } from "@material-ui/core";

const useStyles = makeStyles((theme) => ({
  routeContainer: {
    minHeight: "100%",
    minWidth: "100%",
    padding: theme.spacing(2),
  },
}));

const RouteContainer = ({ children }) => {
  const classes = useStyles();
  return <Box className={classes.routeContainer}>{children}</Box>;
};

export default RouteContainer;
