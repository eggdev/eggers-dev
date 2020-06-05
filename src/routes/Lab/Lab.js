import React from "react";
import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import Grid from "@material-ui/core/Grid";

const Lab = () => {
  return (
    <Container>
      <Grid container item xs={12} justify="center">
        <Typography gutterBottom={true} variant="h3">
          Laboratory
        </Typography>
      </Grid>
    </Container>
  );
};

export default Lab;
