import React from 'react';
import { makeStyles } from "@material-ui/core/styles";
import Grid from "@material-ui/core/Grid";
import Chip from "@material-ui/core/Chip";

const useStyles = makeStyles(theme => ({
  chip: {
    margin: `0 ${theme.spacing(.5)}px`
  }
}))

const Technologies = ({ primary = [], secondary = [] }) => {
  const fullArray = [...primary, ...secondary];
  const classes = useStyles();
	return (
    <>
      {fullArray.map((tool) => <Chip key={tool} className={classes.chip} label={tool} variant="outlined" />)}
    </>
	);
};

export default Technologies;
