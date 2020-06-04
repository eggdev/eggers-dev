import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { Fab } from "@material-ui/core";
import { Brightness2, Brightness5 } from "@material-ui/icons";

const useStyles = makeStyles((theme) => ({
  fab: {
    position: "absolute",
    bottom: theme.spacing(2),
    left: theme.spacing(2),
    zIndex: theme.zIndex.tooltip,
  },
}));

const DarkModeToggle = ({ isDarkMode, toggleDarkMode }) => {
  const classes = useStyles();
  return (
    <Fab className={classes.fab} onClick={toggleDarkMode}>
      {isDarkMode ? <Brightness5 /> : <Brightness2 />}
    </Fab>
  );
};

export default DarkModeToggle;
