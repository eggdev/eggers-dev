import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Grid from "@material-ui/core/Grid";
import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import CircularProgress from "@material-ui/core/CircularProgress";

const useStyles = makeStyles((theme) => ({
  container: {
    position: "relative",
  },
  absolute: {
    position: "absolute",
    top: "25%",
  },
}));

const LoadingContainer = () => {
  const { container, absolute } = useStyles();
  return (
    <Container className={container}>
      <Grid container justify="center" alignItems="center">
        <CircularProgress
          className={absolute}
          size={400}
          thickness={2}
          color="primary"
        />
      </Grid>
    </Container>
  );
};

export default LoadingContainer;
