import React from "react";
import Fade from "@material-ui/core/Fade";
import Typography from "@material-ui/core/Typography";
import Grid from "@material-ui/core/Grid";
import useFetch from "../../hooks/useFetch";

const Lab = () => {
  const [{ data }] = useFetch("lab");

  return (
    <Fade in={true} timeout={500}>
      <Grid container item xs={12} justify="center">
        <Typography gutterBottom={true} variant="h3">
          Works in Progress
        </Typography>
      </Grid>
    </Fade>
  );
};

export default Lab;
