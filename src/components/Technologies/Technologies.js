import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Chip from "@material-ui/core/Chip";
import Grid from "@material-ui/core/Grid";

const useStyles = makeStyles((theme) => ({
  chip: {
    margin: theme.spacing(0.5),
  },
}));

const Technologies = ({ primary = [], secondary = [] }) => {
  const classes = useStyles();
  return (
    <>
      <Grid container justify="center" item xs={12}>
        {primary.map((tool) => (
          <Chip
            key={tool}
            className={classes.chip}
            label={tool}
            variant="outlined"
          />
        ))}
      </Grid>
      <Grid container justify="center" item xs={12}>
        {secondary.map((tool) => (
          <Chip
            key={tool}
            className={classes.chip}
            label={tool}
            variant="outlined"
          />
        ))}
      </Grid>
    </>
  );
};

export default Technologies;
