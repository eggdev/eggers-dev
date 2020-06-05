import React from "react";
import Grid from "@material-ui/core/Grid";
import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";

const LoadingContainer = () => {
  return (
    <Container>
      <Grid container justify="center" alignItems="center">
        <Typography variant="h4">Fetching from Heroku...</Typography>
      </Grid>
    </Container>
  );
};

export default LoadingContainer;
