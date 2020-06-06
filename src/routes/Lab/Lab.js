import React from "react";
import Fade from "@material-ui/core/Fade";
import Typography from "@material-ui/core/Typography";
import Grid from "@material-ui/core/Grid";
import useFetch from "../../hooks/useFetch";

const Lab = () => {
  const [{ data }] = useFetch("lab");

  return (
    <Fade in={true} timeout={500}>
      <Grid container item xs={12} alignItems="center" direction="column">
        <Typography gutterBottom={true} variant="h3">
          Work in Progress
        </Typography>
        <Typography variant="h6">Cool things I'm building</Typography>
      </Grid>
    </Fade>
  );
};

export default Lab;
