import React from "react";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import CakeIcon from "@material-ui/icons/Cake";

const ErrorComponent = () => {
  return (
    <Grid container alignItems="center" direction="column">
      <Typography variant="h1">
        <CakeIcon fontSize="large" />
      </Typography>
      <Typography variant="h4">Something went wrong!</Typography>
      <Typography variant="h4">Wish for better luck</Typography>
    </Grid>
  );
};

export default ErrorComponent;
